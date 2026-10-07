package testserver

import (
	"bytes"
	"context"
	"fmt"
	"image"
	"image/color"
	"image/png"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"

	"github.com/labstack/echo/v4"
	"github.com/stretchr/testify/require"
	"google.golang.org/protobuf/encoding/protojson"

	apiv1 "github.com/usememos/memos/api/v1"
	apiv2pb "github.com/usememos/memos/proto/gen/api/v2"
	"github.com/usememos/memos/store"
)

// TestStreamResourceFromFileAndBlob verifies that a resource is served correctly
// both from a file on disk and from the database blob. The file case is streamed
// rather than read into memory, so make sure the bytes still arrive intact.
func TestStreamResourceFromFileAndBlob(t *testing.T) {
	ctx := context.Background()
	s, err := NewTestingServer(ctx, t)
	require.NoError(t, err)
	defer s.Shutdown(ctx)

	user, err := s.postAuthSignUp(&apiv1.SignUp{
		Username: "resourceuser",
		Password: "resourcepassword",
	})
	require.NoError(t, err)

	// 1. Served from the blob column.
	blobPayload := []byte("blob-payload")
	blobResource, err := s.server.Store.CreateResource(ctx, &store.Resource{
		CreatorID: user.ID,
		Filename:  "from-blob.txt",
		Type:      "text/plain",
		Size:      int64(len(blobPayload)),
		Blob:      blobPayload,
	})
	require.NoError(t, err)

	// 2. Served from a file on disk, with the blob column deliberately left empty.
	filePayload := []byte("file-payload")
	dir := t.TempDir()
	require.NoError(t, os.WriteFile(filepath.Join(dir, "from-file.txt"), filePayload, 0o600))
	fileResource, err := s.server.Store.CreateResource(ctx, &store.Resource{
		CreatorID:    user.ID,
		Filename:     "from-file.txt",
		Type:         "text/plain",
		Size:         int64(len(filePayload)),
		InternalPath: filepath.Join(dir, "from-file.txt"),
	})
	require.NoError(t, err)

	for _, tc := range []struct {
		name     string
		id       int32
		expected string
	}{
		{"blob", blobResource.ID, string(blobPayload)},
		{"file", fileResource.ID, string(filePayload)},
	} {
		t.Run(tc.name, func(t *testing.T) {
			body, err := s.get(fmt.Sprintf("/o/r/%d", tc.id), nil)
			require.NoError(t, err)
			defer body.Close()

			got, err := io.ReadAll(body)
			require.NoError(t, err)
			require.Equal(t, tc.expected, string(got))
		})
	}
}

// TestPanicInHandlerDoesNotKillServer verifies that a panicking handler is
// contained. echo.New() installs no recovery middleware and grpc-go does not
// recover handler panics either, so before this was fixed a single bad request
// aborted the whole process and took the site down with it.
func TestPanicInHandlerDoesNotKillServer(t *testing.T) {
	ctx := context.Background()
	s, err := NewTestingServer(ctx, t)
	require.NoError(t, err)
	defer s.Shutdown(ctx)

	// Catch a process-wide abort in the test binary too, so that a regression
	// shows up as a readable failure instead of a killed test run.
	defer func() {
		if r := recover(); r != nil {
			t.Fatalf("a panicking handler took the server down: %v", r)
		}
	}()

	echoServer := s.server.GetEcho()
	echoServer.GET("/panic-for-test", func(c echo.Context) error {
		panic("boom")
	})

	rec := httptest.NewRecorder()
	echoServer.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/panic-for-test", nil))
	require.Equal(t, http.StatusInternalServerError, rec.Code)

	// The server must keep serving normal traffic afterwards.
	rec = httptest.NewRecorder()
	echoServer.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/healthz", nil))
	require.Equal(t, http.StatusOK, rec.Code)
}

// TestUpdateUserRoleIsPersisted verifies a role change is actually written.
// api/v2 UserService.UpdateUser puts a Role into the update struct, so a driver
// that ignores it reports success while leaving the old role in place.
func TestUpdateUserRoleIsPersisted(t *testing.T) {
	ctx := context.Background()
	s, err := NewTestingServer(ctx, t)
	require.NoError(t, err)
	defer s.Shutdown(ctx)

	user, err := s.postAuthSignUp(&apiv1.SignUp{
		Username: "roleuser",
		Password: "rolepassword",
	})
	require.NoError(t, err)

	role := store.RoleUser
	updated, err := s.server.Store.UpdateUser(ctx, &store.UpdateUser{ID: user.ID, Role: &role})
	require.NoError(t, err)
	require.Equal(t, store.RoleUser, updated.Role)
}

// TestUpdateUserWithNoFieldsReturnsError verifies that an update carrying no
// field is rejected cleanly instead of reaching SQLite as a statement with an
// empty SET clause, which failed with an opaque "SQL logic error".
func TestUpdateUserWithNoFieldsReturnsError(t *testing.T) {
	ctx := context.Background()
	s, err := NewTestingServer(ctx, t)
	require.NoError(t, err)
	defer s.Shutdown(ctx)

	_, err = s.server.Store.UpdateUser(ctx, &store.UpdateUser{ID: 1})
	require.Error(t, err)
	require.Contains(t, err.Error(), "no fields to update")
}

// TestCreateMemoWithoutDisablePublicMemosSetting covers a nil dereference that
// took down CreateMemo on every install where the "disable public memos" setting
// had never been written.
//
// Store.GetSystemSetting returns (nil, nil) when the row does not exist, which
// is the normal state of a fresh install. getDisablePublicMemosSystemSettingValue
// passed that nil straight into disablePublicMemosSystemSetting.Value, so the
// first memo created on a fresh instance panicked with "invalid memory address
// or nil pointer dereference". The sibling helper
// getMemoDisplayWithUpdatedTsSettingValue already guards for nil; this one did
// not.
func TestCreateMemoWithoutDisablePublicMemosSetting(t *testing.T) {
	ctx := context.Background()
	s, err := NewTestingServer(ctx, t)
	require.NoError(t, err)
	defer s.Shutdown(ctx)

	// The setting must genuinely be absent, otherwise this test proves nothing.
	setting, err := s.server.Store.GetSystemSetting(ctx, &store.FindSystemSetting{
		Name: apiv1.SystemSettingDisablePublicMemosName.String(),
	})
	require.NoError(t, err)
	require.Nil(t, setting, "fresh install is expected to have no such setting")

	_, err = s.postAuthSignUp(&apiv1.SignUp{
		Username: "nopublicsetting",
		Password: "nopublicpassword",
	})
	require.NoError(t, err)

	// Go through the v2 gRPC gateway, which is the path that panicked. A panic
	// there is swallowed by the recovery interceptor and reported as an internal
	// error, so assert on the outcome rather than expecting the process to die.
	body, err := s.post("/api/v2/memos", bytes.NewReader([]byte(
		`{"content":"first memo on a fresh install","visibility":"PRIVATE"}`)), nil)
	require.NoError(t, err)
	defer body.Close()

	raw, err := io.ReadAll(body)
	require.NoError(t, err)

	resp := &apiv2pb.CreateMemoResponse{}
	require.NoError(t, protojson.Unmarshal(raw, resp),
		"CreateMemo returned an error instead of a memo: %s", string(raw))
	require.NotNil(t, resp.GetMemo())
	require.Equal(t, "first memo on a fresh install", resp.GetMemo().GetContent())
}

func TestListMemosV2BatchRelationsAndResources(t *testing.T) {
	ctx := context.Background()
	s, err := NewTestingServer(ctx, t)
	require.NoError(t, err)
	defer s.Shutdown(ctx)

	user, err := s.postAuthSignUp(&apiv1.SignUp{
		Username: "batchuser",
		Password: "batchpassword",
	})
	require.NoError(t, err)

	// Create memo 1
	body1, err := s.post("/api/v2/memos", bytes.NewReader([]byte(
		`{"content":"first batch memo","visibility":"PRIVATE"}`)), nil)
	require.NoError(t, err)
	defer body1.Close()
	raw1, err := io.ReadAll(body1)
	require.NoError(t, err)
	resp1 := &apiv2pb.CreateMemoResponse{}
	require.NoError(t, protojson.Unmarshal(raw1, resp1))
	memo1 := resp1.GetMemo()
	require.NotNil(t, memo1)

	// Create memo 2
	body2, err := s.post("/api/v2/memos", bytes.NewReader([]byte(
		`{"content":"second batch memo","visibility":"PRIVATE"}`)), nil)
	require.NoError(t, err)
	defer body2.Close()
	raw2, err := io.ReadAll(body2)
	require.NoError(t, err)
	resp2 := &apiv2pb.CreateMemoResponse{}
	require.NoError(t, protojson.Unmarshal(raw2, resp2))
	memo2 := resp2.GetMemo()
	require.NotNil(t, memo2)

	// Attach a resource to memo 1
	memoID1 := memo1.Id
	_, err = s.server.Store.CreateResource(ctx, &store.Resource{
		CreatorID: user.ID,
		Filename:  "attachment.png",
		Type:      "image/png",
		MemoID:    &memoID1,
	})
	require.NoError(t, err)

	// Add a relation between memo 1 and memo 2
	_, err = s.server.Store.UpsertMemoRelation(ctx, &store.MemoRelation{
		MemoID:        memo1.Id,
		RelatedMemoID: memo2.Id,
		Type:          store.MemoRelationReference,
	})
	require.NoError(t, err)

	// List memos via v2 API
	listBody, err := s.get("/api/v2/memos", map[string]string{
		"filter": `visibilities == ["PRIVATE"]`,
	})
	require.NoError(t, err)
	defer listBody.Close()

	listRaw, err := io.ReadAll(listBody)
	require.NoError(t, err)

	listResp := &apiv2pb.ListMemosResponse{}
	require.NoError(t, protojson.Unmarshal(listRaw, listResp))
	require.Len(t, listResp.GetMemos(), 2)

	// Find memo 1 in response
	var foundMemo1, foundMemo2 *apiv2pb.Memo
	for _, m := range listResp.GetMemos() {
		if m.Id == memo1.Id {
			foundMemo1 = m
		} else if m.Id == memo2.Id {
			foundMemo2 = m
		}
	}
	require.NotNil(t, foundMemo1)
	require.NotNil(t, foundMemo2)

	// Verify creator
	require.Equal(t, fmt.Sprintf("users/%s", user.Username), foundMemo1.Creator)
	require.Equal(t, fmt.Sprintf("users/%s", user.Username), foundMemo2.Creator)

	// Verify resources on memo 1
	require.Len(t, foundMemo1.Resources, 1)
	require.Equal(t, "attachment.png", foundMemo1.Resources[0].Filename)
	require.Len(t, foundMemo2.Resources, 0)

	// Verify relations on memo 1 and memo 2
	require.Len(t, foundMemo1.Relations, 1)
	require.Equal(t, memo2.Id, foundMemo1.Relations[0].RelatedMemoId)
	require.Len(t, foundMemo2.Relations, 1)
	require.Equal(t, memo1.Id, foundMemo2.Relations[0].MemoId)
}

func TestStreamResourceThumbnailCacheAndETag(t *testing.T) {
	ctx := context.Background()
	s, err := NewTestingServer(ctx, t)
	require.NoError(t, err)
	defer s.Shutdown(ctx)

	user, err := s.postAuthSignUp(&apiv1.SignUp{
		Username: "thumbuser",
		Password: "thumbpassword",
	})
	require.NoError(t, err)

	// Generate a 100x100 test PNG image
	img := image.NewRGBA(image.Rect(0, 0, 100, 100))
	for x := 0; x < 100; x++ {
		for y := 0; y < 100; y++ {
			img.Set(x, y, color.RGBA{R: 255, G: 0, B: 0, A: 255})
		}
	}
	var imgBuf bytes.Buffer
	require.NoError(t, png.Encode(&imgBuf, img))

	// Save original image to disk
	tmpDir := t.TempDir()
	originalPath := filepath.Join(tmpDir, "test.png")
	require.NoError(t, os.WriteFile(originalPath, imgBuf.Bytes(), 0o644))

	res, err := s.server.Store.CreateResource(ctx, &store.Resource{
		CreatorID:    user.ID,
		Filename:     "test.png",
		Type:         "image/png",
		Size:         int64(imgBuf.Len()),
		InternalPath: originalPath,
	})
	require.NoError(t, err)

	echoServer := s.server.GetEcho()

	// 1. Initial request with thumbnail=1 should generate thumbnail and return 200 OK + ETag
	req1 := httptest.NewRequest(http.MethodGet, fmt.Sprintf("/o/r/%d?thumbnail=1", res.ID), nil)
	rec1 := httptest.NewRecorder()
	echoServer.ServeHTTP(rec1, req1)
	require.Equal(t, http.StatusOK, rec1.Code)
	etag := rec1.Header().Get("ETag")
	require.NotEmpty(t, etag)
	require.Contains(t, etag, "thumb")

	// Verify thumbnail was saved to .thumbnail_cache
	cachedPath := filepath.Join(s.profile.Data, ".thumbnail_cache", fmt.Sprintf("%d.png", res.ID))
	cachedInfo, err := os.Stat(cachedPath)
	require.NoError(t, err)
	require.Greater(t, cachedInfo.Size(), int64(0))

	// 2. Request with matching If-None-Match should return 304 Not Modified
	req2 := httptest.NewRequest(http.MethodGet, fmt.Sprintf("/o/r/%d?thumbnail=1", res.ID), nil)
	req2.Header.Set("If-None-Match", etag)
	rec2 := httptest.NewRecorder()
	echoServer.ServeHTTP(rec2, req2)
	require.Equal(t, http.StatusNotModified, rec2.Code)
	require.Empty(t, rec2.Body.Bytes())

	// 3. Delete original source file; thumbnail should still serve from disk cache directly without errors
	require.NoError(t, os.Remove(originalPath))
	req3 := httptest.NewRequest(http.MethodGet, fmt.Sprintf("/o/r/%d?thumbnail=1", res.ID), nil)
	rec3 := httptest.NewRecorder()
	echoServer.ServeHTTP(rec3, req3)
	require.Equal(t, http.StatusOK, rec3.Code)
	require.Greater(t, len(rec3.Body.Bytes()), 0)
}

