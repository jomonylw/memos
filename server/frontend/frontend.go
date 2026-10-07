package frontend

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"strings"

	"github.com/labstack/echo/v4"
	"github.com/labstack/echo/v4/middleware"
	"go.uber.org/zap"

	apiv1 "github.com/usememos/memos/api/v1"
	"github.com/usememos/memos/internal/log"
	"github.com/usememos/memos/internal/util"
	"github.com/usememos/memos/plugin/gomark/parser"
	"github.com/usememos/memos/plugin/gomark/parser/tokenizer"
	"github.com/usememos/memos/plugin/gomark/renderer"
	"github.com/usememos/memos/server/profile"
	"github.com/usememos/memos/store"
)

const (
	// maxMetadataDescriptionLength is the maximum length of metadata description.
	maxMetadataDescriptionLength = 256

	// distRoot is the directory containing the built frontend assets.
	distRoot = "dist"

	// assetCacheControl marks content-hashed assets as immutable. Their URL changes
	// whenever their content changes, so they can be cached indefinitely.
	assetCacheControl = "public, max-age=31536000, immutable"

	// htmlCacheControl prevents browsers from pinning a stale index.html. A cached
	// index.html references asset URLs that no longer exist on the server; because
	// the static middleware falls back to index.html with HTTP 200, the browser
	// receives HTML where it expects JavaScript and renders a blank page.
	htmlCacheControl = "no-cache, no-store, must-revalidate"
)

var (
	// assetRefPattern matches the built asset URLs referenced by index.html.
	assetRefPattern = regexp.MustCompile(`(?:src|href)="(/assets/[^"]+)"`)
)

type FrontendService struct {
	Profile *profile.Profile
	Store   *store.Store
}

func NewFrontendService(profile *profile.Profile, store *store.Store) *FrontendService {
	return &FrontendService{
		Profile: profile,
		Store:   store,
	}
}

func (s *FrontendService) Serve(ctx context.Context, e *echo.Echo) {
	// Verify at startup that every asset referenced by index.html is actually
	// present on disk. A mismatch here is the root cause of the blank page that
	// occurs when a browser holds a stale, cached index.html.
	verifyDistAssets()

	// Serve content-hashed assets explicitly, ahead of the HTML5 static middleware,
	// so that a missing asset yields 404 instead of being answered with index.html.
	e.GET("/assets/*", assetHandler(distRoot))

	// NOTE: middleware runs in registration order, so cacheControlMiddleware must be
	// registered BEFORE the static middleware in order to wrap it and observe the
	// response it writes.
	e.Use(cacheControlMiddleware)
	e.Use(staticMiddleware(distRoot))

	s.registerRoutes(e)
	s.registerFileRoutes(ctx, e)
}

// staticMiddleware serves the built frontend assets. In HTML5 mode the static
// middleware answers any unmatched path with index.html and HTTP 200, which is what
// lets client-side routes such as /m/123 work on a full page load.
//
// Asset requests are deliberately excluded from that fallback and handled by
// assetHandler instead: serving index.html in place of a missing asset is what turns
// a stale browser cache into a blank page.
func staticMiddleware(root string) echo.MiddlewareFunc {
	return middleware.StaticWithConfig(middleware.StaticConfig{
		Root:  root,
		HTML5: true,
		Skipper: func(c echo.Context) bool {
			if isAssetPath(c.Request().URL.Path) {
				return true
			}
			return util.HasPrefixes(c.Path(), "/api", "/memos.api.v2", "/robots.txt", "/sitemap.xml", "/m/:memoID")
		},
	})
}

// isAssetPath reports whether a request targets a built frontend asset.
func isAssetPath(path string) bool {
	return strings.HasPrefix(path, "/assets/")
}

// assetHandler serves files below /assets/. Unlike the HTML5 static middleware it
// never substitutes index.html: a missing asset is reported as 404.
//
// Without this, a browser holding a cached index.html from a previous build requests
// an asset URL that the current build does not contain. The HTML5 fallback answers
// with index.html and status 200, the browser receives HTML where it expects
// JavaScript, fails to parse it, and renders a blank page - while the request log
// shows nothing but healthy 200s.
func assetHandler(root string) echo.HandlerFunc {
	return func(c echo.Context) error {
		// c.Param("*") is the wildcard remainder, already cleaned by echo.
		name := filepath.Join(root, "assets", filepath.FromSlash(c.Param("*")))
		info, err := os.Stat(name)
		if err != nil || info.IsDir() {
			// Never cache a failure, or the browser keeps re-requesting the missing
			// asset instead of reloading index.html.
			c.Response().Header().Set(echo.HeaderCacheControl, "no-store")
			log.Warn("requested frontend asset does not exist on disk; a browser with "+
				"a cached index.html will show a blank page until its cache is cleared",
				zap.String("path", c.Request().URL.Path),
				zap.String("resolved", name),
				zap.String("remote_addr", c.RealIP()))
			return echo.NewHTTPError(http.StatusNotFound, "asset not found")
		}

		// Content-hashed assets never change under the same URL, so they can be
		// cached indefinitely.
		c.Response().Header().Set(echo.HeaderCacheControl, assetCacheControl)
		return c.File(name)
	}
}

// cacheControlMiddleware applies the caching policy for frontend responses.
//
// index.html must never be cached. Otherwise a browser keeps a cached index.html
// across an upgrade and requests asset URLs from a build that no longer exists on
// the server. Content-hashed assets, by contrast, can be cached indefinitely
// because their URL changes whenever their content does.
func cacheControlMiddleware(next echo.HandlerFunc) echo.HandlerFunc {
	return func(c echo.Context) error {
		path := c.Request().URL.Path
		isHTML := path == "/" || strings.HasSuffix(path, ".html") || !strings.Contains(path, ".")

		// Headers must be set BEFORE the handler runs. Echo commits the response the
		// moment the handler writes to it, and any header set afterwards is silently
		// dropped.
		if isHTML && !isAssetPath(path) {
			c.Response().Header().Set(echo.HeaderCacheControl, htmlCacheControl)
		}
		return next(c)
	}
}

// verifyDistAssets checks that the assets referenced by the built index.html exist
// on disk, and logs their identity so that a blank page caused by mismatched
// caches can be diagnosed from the server log alone.
//
// The failure mode is subtle: the static middleware is configured with HTML5 mode,
// so a request for a missing asset is answered with index.html and HTTP 200. A
// browser running an older cached index.html therefore requests an asset URL from a
// previous build, receives HTML instead of JavaScript, fails to parse it, and
// renders nothing at all - with no error anywhere in the request log.
func verifyDistAssets() {
	dist := distRoot
	indexPath := filepath.Join(dist, "index.html")
	content, err := os.ReadFile(indexPath)
	if err != nil {
		log.Error("failed to read frontend index.html; the web UI will not load",
			zap.String("path", indexPath), zap.Error(err))
		return
	}

	// The hash of index.html identifies the exact build the browser is being served.
	sum := sha256.Sum256(content)
	refs := findAssetRefs(string(content))
	missing := findMissingAssets(dist, refs)

	fields := []zap.Field{
		zap.String("path", indexPath),
		zap.String("index_sha256", hex.EncodeToString(sum[:])),
		zap.Int("asset_refs", len(refs)),
		zap.Int("missing_assets_count", len(missing)),
		zap.Int64("index_bytes", int64(len(content))),
	}

	if len(missing) > 0 {
		// This is the exact condition that produces a blank page for clients whose
		// cached index.html points at an older build.
		log.Error("index.html references assets that do not exist on disk; "+
			"clients with a cached index.html will render a blank page",
			append(fields, zap.Strings("missing_assets", missing))...)
		return
	}

	log.Info("frontend assets verified", fields...)
}

// findAssetRefs extracts the asset URLs that index.html references, in order and
// without duplicates.
func findAssetRefs(indexHTML string) []string {
	matches := assetRefPattern.FindAllStringSubmatch(indexHTML, -1)

	seen := make(map[string]bool, len(matches))
	refs := make([]string, 0, len(matches))
	for _, match := range matches {
		ref := match[1]
		if seen[ref] {
			continue
		}
		seen[ref] = true
		refs = append(refs, ref)
	}
	return refs
}

// findMissingAssets returns the referenced assets that are absent from the dist
// directory rooted at dist.
func findMissingAssets(dist string, refs []string) []string {
	var missing []string
	for _, ref := range refs {
		if _, err := os.Stat(filepath.Join(dist, filepath.FromSlash(ref))); err != nil {
			missing = append(missing, ref)
		}
	}
	return missing
}

func (s *FrontendService) registerRoutes(e *echo.Echo) {
	rawIndexHTML := getRawIndexHTML()

	e.GET("/m/:memoID", func(c echo.Context) error {
		ctx := c.Request().Context()
		memoID, err := util.ConvertStringToInt32(c.Param("memoID"))
		if err != nil {
			// Redirect to `index.html` if any error occurs.
			return c.HTML(http.StatusOK, rawIndexHTML)
		}

		memo, err := s.Store.GetMemo(ctx, &store.FindMemo{
			ID: &memoID,
		})
		if err != nil {
			return c.HTML(http.StatusOK, rawIndexHTML)
		}
		if memo == nil {
			return c.HTML(http.StatusOK, rawIndexHTML)
		}
		creator, err := s.Store.GetUser(ctx, &store.FindUser{
			ID: &memo.CreatorID,
		})
		if err != nil {
			return c.HTML(http.StatusOK, rawIndexHTML)
		}

		// Inject memo metadata into `index.html`.
		indexHTML := strings.ReplaceAll(rawIndexHTML, "<!-- memos.metadata.head -->", generateMemoMetadata(memo, creator).String())
		indexHTML = strings.ReplaceAll(indexHTML, "<!-- memos.metadata.body -->", fmt.Sprintf("<!-- memos.memo.%d -->", memo.ID))
		return c.HTML(http.StatusOK, indexHTML)
	})
}

func (s *FrontendService) registerFileRoutes(ctx context.Context, e *echo.Echo) {
	instanceURLSetting, err := s.Store.GetSystemSetting(ctx, &store.FindSystemSetting{
		Name: apiv1.SystemSettingInstanceURLName.String(),
	})
	if err != nil || instanceURLSetting == nil {
		return
	}
	instanceURL := instanceURLSetting.Value
	if instanceURL == "" {
		return
	}

	e.GET("/robots.txt", func(c echo.Context) error {
		robotsTxt := fmt.Sprintf(`User-agent: *
Allow: /
Host: %s
Sitemap: %s/sitemap.xml`, instanceURL, instanceURL)
		return c.String(http.StatusOK, robotsTxt)
	})

	e.GET("/sitemap.xml", func(c echo.Context) error {
		ctx := c.Request().Context()
		urlsets := []string{}
		// Append memo list.
		memoList, err := s.Store.ListMemos(ctx, &store.FindMemo{
			VisibilityList: []store.Visibility{store.Public},
		})
		if err != nil {
			return err
		}
		for _, memo := range memoList {
			urlsets = append(urlsets, fmt.Sprintf(`<url><loc>%s</loc></url>`, fmt.Sprintf("%s/m/%d", instanceURL, memo.ID)))
		}
		sitemap := fmt.Sprintf(`<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:news="http://www.google.com/schemas/sitemap-news/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml" xmlns:mobile="http://www.google.com/schemas/sitemap-mobile/1.0" xmlns:image="http://www.google.com/schemas/sitemap-image/1.1" xmlns:video="http://www.google.com/schemas/sitemap-video/1.1">%s</urlset>`, strings.Join(urlsets, "\n"))
		return c.XMLBlob(http.StatusOK, []byte(sitemap))
	})
}

func generateMemoMetadata(memo *store.Memo, creator *store.User) *Metadata {
	metadata := getDefaultMetadata()
	metadata.Title = fmt.Sprintf("%s(@%s) on Memos", creator.Nickname, creator.Username)
	if memo.Visibility == store.Public {
		tokens := tokenizer.Tokenize(memo.Content)
		nodes, _ := parser.Parse(tokens)
		description := renderer.NewStringRenderer().Render(nodes)
		if len(description) == 0 {
			description = memo.Content
		}
		if len(description) > maxMetadataDescriptionLength {
			description = description[:maxMetadataDescriptionLength] + "..."
		}
		metadata.Description = description
	}

	return metadata
}

// getRawIndexHTML reads the built index.html. A read failure yields an empty
// string, which would be served as a blank page with HTTP 200, so report it loudly.
func getRawIndexHTML() string {
	bytes, err := os.ReadFile(filepath.Join(distRoot, "index.html"))
	if err != nil {
		log.Error("failed to read frontend index.html; memo pages will be blank",
			zap.String("path", filepath.Join(distRoot, "index.html")), zap.Error(err))
		return ""
	}
	return string(bytes)
}

type Metadata struct {
	Title       string
	Description string
	ImageURL    string
}

func getDefaultMetadata() *Metadata {
	return &Metadata{
		Title:       "Memos",
		Description: "A privacy-first, lightweight note-taking service. Easily capture and share your great thoughts.",
		ImageURL:    "/logo.webp",
	}
}

func (m *Metadata) String() string {
	metadataList := []string{
		fmt.Sprintf(`<meta name="description" content="%s" />`, m.Description),
		fmt.Sprintf(`<meta property="og:title" content="%s" />`, m.Title),
		fmt.Sprintf(`<meta property="og:description" content="%s" />`, m.Description),
		fmt.Sprintf(`<meta property="og:image" content="%s" />`, m.ImageURL),
		`<meta property="og:type" content="website" />`,
		// Twitter related fields.
		fmt.Sprintf(`<meta property="twitter:title" content="%s" />`, m.Title),
		fmt.Sprintf(`<meta property="twitter:description" content="%s" />`, m.Description),
		fmt.Sprintf(`<meta property="twitter:image" content="%s" />`, m.ImageURL),
		`<meta name="twitter:card" content="summary" />`,
		`<meta name="twitter:creator" content="memos" />`,
	}
	return strings.Join(metadataList, "\n")
}
