package testserver

import (
	"context"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"

	"github.com/labstack/echo/v4"
	"github.com/stretchr/testify/require"

	apiv1 "github.com/usememos/memos/api/v1"
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
