package resource

import (
	"bytes"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"runtime"
	"runtime/debug"
	"strings"
	"sync"
	"time"

	"github.com/disintegration/imaging"
	"github.com/labstack/echo/v4"
	"go.uber.org/zap"

	"github.com/usememos/memos/internal/log"
	"github.com/usememos/memos/internal/util"
	"github.com/usememos/memos/server/profile"
	"github.com/usememos/memos/store"
)

const (
	// The key name used to store user id in the context
	// user id is extracted from the jwt token subject field.
	userIDContextKey = "user-id"
	// thumbnailImagePath is the directory to store image thumbnails.
	thumbnailImagePath = ".thumbnail_cache"
)

// thumbnailSem limits concurrent image decoding so multiple simultaneous
// requests don't spike server RAM with uncompressed RGBA pixel buffers.
var thumbnailSem = make(chan struct{}, 2)

var (
	memReleaseTimer *time.Timer
	memReleaseMu    sync.Mutex
)

// scheduleMemoryRelease triggers a garbage collection and returns unused
// physical memory back to the OS after thumbnail processing finishes.
func scheduleMemoryRelease() {
	memReleaseMu.Lock()
	defer memReleaseMu.Unlock()
	if memReleaseTimer != nil {
		memReleaseTimer.Stop()
	}
	memReleaseTimer = time.AfterFunc(3*time.Second, func() {
		runtime.GC()
		debug.FreeOSMemory()
	})
}

type Service struct {
	Profile *profile.Profile
	Store   *store.Store
}

func NewService(profile *profile.Profile, store *store.Store) *Service {
	return &Service{
		Profile: profile,
		Store:   store,
	}
}

func (s *Service) RegisterResourcePublicRoutes(g *echo.Group) {
	g.GET("/r/:resourceId", s.streamResource)
	g.GET("/r/:resourceId/*", s.streamResource)
}

func (s *Service) streamResource(c echo.Context) error {
	ctx := c.Request().Context()
	resourceID, err := util.ConvertStringToInt32(c.Param("resourceId"))
	if err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, fmt.Sprintf("ID is not a number: %s", c.Param("resourceId"))).SetInternal(err)
	}

	// 1. Fetch metadata only (GetBlob: false) so we don't load multi-megabyte blobs into RAM unnecessarily.
	resource, err := s.Store.GetResource(ctx, &store.FindResource{
		ID:      &resourceID,
		GetBlob: false,
	})
	if err != nil {
		return echo.NewHTTPError(http.StatusInternalServerError, fmt.Sprintf("Failed to find resource by ID: %v", resourceID)).SetInternal(err)
	}
	if resource == nil {
		return echo.NewHTTPError(http.StatusNotFound, fmt.Sprintf("Resource not found: %d", resourceID))
	}
	// Check the related memo visibility.
	if resource.MemoID != nil {
		memo, err := s.Store.GetMemo(ctx, &store.FindMemo{
			ID: resource.MemoID,
		})
		if err != nil {
			return echo.NewHTTPError(http.StatusInternalServerError, fmt.Sprintf("Failed to find memo by ID: %v", resource.MemoID)).SetInternal(err)
		}
		if memo != nil && memo.Visibility != store.Public {
			userID, ok := c.Get(userIDContextKey).(int32)
			if !ok || (memo.Visibility == store.Private && userID != resource.CreatorID) {
				return echo.NewHTTPError(http.StatusUnauthorized, "Resource visibility not match")
			}
		}
	}

	thumbnail := isThumbnailRequest(c, resource)

	// ETag conditional check
	etag := fmt.Sprintf(`"%d-%d"`, resource.ID, resource.UpdatedTs)
	if thumbnail {
		etag = fmt.Sprintf(`"%d-%d-thumb"`, resource.ID, resource.UpdatedTs)
	}
	c.Response().Header().Set("ETag", etag)
	if match := c.Request().Header.Get("If-None-Match"); match != "" {
		if strings.Contains(match, etag) || match == "*" {
			return c.NoContent(http.StatusNotModified)
		}
	}

	if thumbnail {
		ext := filepath.Ext(resource.Filename)
		if ext == "" {
			if strings.HasPrefix(strings.ToLower(resource.Type), "image/png") {
				ext = ".png"
			} else {
				ext = ".jpg"
			}
		}
		thumbnailPath := filepath.Join(s.Profile.Data, thumbnailImagePath, fmt.Sprintf("%d%s", resource.ID, ext))

		// Fast path: thumbnail already generated on disk. Zero heap allocation, direct file stream.
		if fi, err := os.Stat(thumbnailPath); err == nil && fi.Size() > 0 {
			f, err := os.Open(thumbnailPath)
			if err == nil {
				defer f.Close()
				return s.writeResource(c, resource, f)
			}
		}

		// Slow path: thumbnail needs to be generated.
		// Throttle concurrent decoders so multiple large images don't blow up server RAM.
		select {
		case thumbnailSem <- struct{}{}:
			defer func() {
				<-thumbnailSem
				scheduleMemoryRelease()
			}()
		case <-ctx.Done():
			return ctx.Err()
		}

		// Double-check existence inside semaphore
		if fi, err := os.Stat(thumbnailPath); err == nil && fi.Size() > 0 {
			f, err := os.Open(thumbnailPath)
			if err == nil {
				defer f.Close()
				return s.writeResource(c, resource, f)
			}
		}

		// Prepare source image reader
		var srcReader io.Reader
		if resource.InternalPath != "" {
			srcFile, err := os.Open(s.resolveResourcePath(resource))
			if err != nil {
				return echo.NewHTTPError(http.StatusInternalServerError,
					fmt.Sprintf("Failed to open the local resource: %s", resource.InternalPath)).SetInternal(err)
			}
			defer srcFile.Close()
			srcReader = srcFile
		} else {
			// Database-stored resource: only fetch blob now when decoding is required
			resWithBlob, err := s.Store.GetResource(ctx, &store.FindResource{
				ID:      &resourceID,
				GetBlob: true,
			})
			if err != nil || resWithBlob == nil || len(resWithBlob.Blob) == 0 {
				return echo.NewHTTPError(http.StatusInternalServerError, "Failed to fetch resource blob").SetInternal(err)
			}
			srcReader = bytes.NewReader(resWithBlob.Blob)
		}

		srcImg, err := imaging.Decode(srcReader, imaging.AutoOrientation(true))
		if err != nil {
			log.Warn(fmt.Sprintf("failed to decode thumbnail image %s", thumbnailPath), zap.Error(err))
		} else {
			thumbnailImage := imaging.Resize(srcImg, 512, 0, imaging.CatmullRom)
			dstDir := filepath.Dir(thumbnailPath)
			if err := os.MkdirAll(dstDir, os.ModePerm); err != nil {
				return echo.NewHTTPError(http.StatusInternalServerError, "Failed to create thumbnail directory").SetInternal(err)
			}
			tmpPath := fmt.Sprintf("%s.tmp-%d%s", thumbnailPath, time.Now().UnixNano(), ext)
			if err := imaging.Save(thumbnailImage, tmpPath); err == nil {
				if err := os.Rename(tmpPath, thumbnailPath); err != nil {
					_ = os.Remove(tmpPath)
				}
			} else {
				log.Warn(fmt.Sprintf("failed to save thumbnail image %s", thumbnailPath), zap.Error(err))
				_ = os.Remove(tmpPath)
			}

			if f, err := os.Open(thumbnailPath); err == nil {
				defer f.Close()
				return s.writeResource(c, resource, f)
			}
		}
	}

	// Serve original resource (non-thumbnail or fallback)
	if resource.InternalPath != "" {
		f, err := os.Open(s.resolveResourcePath(resource))
		if err != nil {
			return echo.NewHTTPError(http.StatusInternalServerError,
				fmt.Sprintf("Failed to open the local resource: %s", resource.InternalPath)).SetInternal(err)
		}
		defer f.Close()
		return s.writeResource(c, resource, f)
	}

	resWithBlob, err := s.Store.GetResource(ctx, &store.FindResource{
		ID:      &resourceID,
		GetBlob: true,
	})
	if err != nil || resWithBlob == nil {
		return echo.NewHTTPError(http.StatusInternalServerError, "Failed to fetch resource blob").SetInternal(err)
	}
	return s.writeResource(c, resource, bytes.NewReader(resWithBlob.Blob))
}

// writeResource sends the resource body. Audio, video, and image go through
// http.ServeContent so that range requests and Last-Modified / 304 keep working.
func (*Service) writeResource(c echo.Context, resource *store.Resource, content io.ReadSeeker) error {
	c.Response().Writer.Header().Set(echo.HeaderCacheControl, "max-age=3600")
	c.Response().Writer.Header().Set(echo.HeaderContentSecurityPolicy, "default-src 'none'; script-src 'none'; img-src 'self'; media-src 'self'; sandbox;")
	c.Response().Writer.Header().Set("Content-Disposition", fmt.Sprintf(`filename="%s"`, resource.Filename))

	resourceType := strings.ToLower(resource.Type)
	if strings.HasPrefix(resourceType, "text") {
		resourceType = echo.MIMETextPlainCharsetUTF8
		return c.Stream(http.StatusOK, resourceType, content)
	}

	if resourceType != "" {
		c.Response().Header().Set(echo.HeaderContentType, resourceType)
	}
	modTime := time.Unix(resource.UpdatedTs, 0)
	if resource.UpdatedTs == 0 {
		modTime = time.Now()
	}
	http.ServeContent(c.Response(), c.Request(), resource.Filename, modTime, content)
	return nil
}

// isThumbnailRequest reports whether the caller asked for a generated thumbnail.
func isThumbnailRequest(c echo.Context, resource *store.Resource) bool {
	return c.QueryParam("thumbnail") == "1" && util.HasPrefixes(strings.ToLower(resource.Type), "image/png", "image/jpeg", "image/jpg")
}

func (s *Service) resolveResourcePath(resource *store.Resource) string {
	resourcePath := filepath.FromSlash(resource.InternalPath)
	if !filepath.IsAbs(resourcePath) {
		resourcePath = filepath.Join(s.Profile.Data, resourcePath)
	}
	return resourcePath
}
