package teststore

import (
	"context"
	"testing"

	"github.com/stretchr/testify/require"

	"github.com/usememos/memos/store"
)

// TestUserStoreUpdateNoOp verifies that an update carrying no changed field is
// rejected with a clear error instead of producing a malformed statement.
func TestUserStoreUpdateNoOp(t *testing.T) {
	ctx := context.Background()
	ts := NewTestingStore(ctx, t)
	defer ts.Close()

	host, err := createTestingHostUser(ctx, ts)
	require.NoError(t, err)

	_, err = ts.UpdateUser(ctx, &store.UpdateUser{ID: host.ID})
	require.Error(t, err, "an update with no fields must fail, not emit 'SET  WHERE id = ?'")
}

// TestGetUserWithExtraFilterIgnoresCache verifies that a lookup combining an ID
// with another filter is not answered from the ID-keyed cache. The cache can only
// answer "by ID alone", so a query that also filters on row_status must reach the
// database instead of returning a cached user that does not match the filter.
func TestGetUserWithExtraFilterIgnoresCache(t *testing.T) {
	ctx := context.Background()
	ts := NewTestingStore(ctx, t)
	defer ts.Close()

	user, err := createTestingHostUser(ctx, ts)
	require.NoError(t, err)

	// Warm the cache with a lookup by ID only.
	_, err = ts.GetUser(ctx, &store.FindUser{ID: &user.ID})
	require.NoError(t, err)

	// The user is NORMAL, so asking for the same ID with an ARCHIVED filter must
	// not match, even though the cached copy says the user exists.
	archived := store.Archived
	found, err := ts.GetUser(ctx, &store.FindUser{ID: &user.ID, RowStatus: &archived})
	require.NoError(t, err)
	require.Nil(t, found, "a filtered lookup must not be served from the ID cache")

	// A matching filter must still find the user.
	normal := store.Normal
	found, err = ts.GetUser(ctx, &store.FindUser{ID: &user.ID, RowStatus: &normal})
	require.NoError(t, err)
	require.NotNil(t, found)
	require.Equal(t, user.ID, found.ID)
}

// TestDeleteMemoRemovesResources verifies that deleting a memo also removes the
// resources that were attached to it. The resource table has no foreign key on
// memo_id, so nothing cascades on its own and the attachment would otherwise stay
// reachable through the public /r/:resourceId route.
func TestDeleteMemoRemovesResources(t *testing.T) {
	ctx := context.Background()
	ts := NewTestingStore(ctx, t)
	defer ts.Close()

	user, err := createTestingHostUser(ctx, ts)
	require.NoError(t, err)

	memo, err := ts.CreateMemo(ctx, &store.Memo{
		CreatorID:  user.ID,
		Content:    "memo with an attachment",
		Visibility: store.Public,
	})
	require.NoError(t, err)

	resource, err := ts.CreateResource(ctx, &store.Resource{
		CreatorID: user.ID,
		MemoID:    &memo.ID,
		Filename:  "attachment.png",
		Type:      "image/png",
		Blob:      []byte("not-a-real-png"),
	})
	require.NoError(t, err)
	require.NotZero(t, resource.ID)

	require.NoError(t, ts.DeleteMemo(ctx, &store.DeleteMemo{ID: memo.ID}))

	resources, err := ts.ListResources(ctx, &store.FindResource{})
	require.NoError(t, err)
	require.Empty(t, resources, "resources attached to a deleted memo must be removed")
}

// TestDeleteMissingResourceReturnsError verifies that deleting a resource that
// does not exist reports a failure. errors.Wrap(nil, ...) returns nil, so the
// guard used to succeed silently and the caller answered "deleted".
func TestDeleteMissingResourceReturnsError(t *testing.T) {
	ctx := context.Background()
	ts := NewTestingStore(ctx, t)
	defer ts.Close()

	err := ts.DeleteResource(ctx, &store.DeleteResource{ID: 999999})
	require.Error(t, err, "deleting a missing resource must not report success")
}

// UpdateUser callers (api/v2 UserService.UpdateUser) put a Role into the
// update struct, so a driver that silently ignores it leaves the user with
// their old role while reporting success.
func TestUserStoreUpdateRole(t *testing.T) {
	ctx := context.Background()
	ts := NewTestingStore(ctx, t)
	defer ts.Close()

	host, err := createTestingHostUser(ctx, ts)
	require.NoError(t, err)

	// Promote the host user to a plain user and back again.
	promoted := store.RoleUser
	updated, err := ts.UpdateUser(ctx, &store.UpdateUser{ID: host.ID, Role: &promoted})
	require.NoError(t, err)
	require.Equal(t, promoted, updated.Role, "UpdateUser must return the persisted role")

	// Re-read from the database (bypassing the cache) to be sure it was written.
	stored, err := ts.ListUsers(ctx, &store.FindUser{ID: &host.ID})
	require.NoError(t, err)
	require.Len(t, stored, 1)
	require.Equal(t, promoted, stored[0].Role, "role must be persisted to the database")
}
