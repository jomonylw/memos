package teststore

import (
	"context"
	"testing"

	"github.com/stretchr/testify/require"

	"github.com/usememos/memos/store"
)

func TestResourceStore(t *testing.T) {
	ctx := context.Background()
	ts := NewTestingStore(ctx, t)
	_, err := ts.CreateResource(ctx, &store.Resource{
		CreatorID:    101,
		Filename:     "test.epub",
		Blob:         []byte("test"),
		InternalPath: "",
		ExternalLink: "",
		Type:         "application/epub+zip",
		Size:         637607,
	})
	require.NoError(t, err)

	correctFilename := "test.epub"
	incorrectFilename := "test.png"
	resource, err := ts.GetResource(ctx, &store.FindResource{
		Filename: &correctFilename,
	})
	require.NoError(t, err)
	require.Equal(t, correctFilename, resource.Filename)
	require.Equal(t, int32(1), resource.ID)

	notFoundResource, err := ts.GetResource(ctx, &store.FindResource{
		Filename: &incorrectFilename,
	})
	require.NoError(t, err)
	require.Nil(t, notFoundResource)

	var correctCreatorID int32 = 101
	var incorrectCreatorID int32 = 102
	_, err = ts.GetResource(ctx, &store.FindResource{
		CreatorID: &correctCreatorID,
	})
	require.NoError(t, err)

	notFoundResource, err = ts.GetResource(ctx, &store.FindResource{
		CreatorID: &incorrectCreatorID,
	})
	require.NoError(t, err)
	require.Nil(t, notFoundResource)

	err = ts.DeleteResource(ctx, &store.DeleteResource{
		ID: 1,
	})
	require.NoError(t, err)
	// ID 2 never existed. DeleteResource must report that instead of returning
	// nil, otherwise the API layer answers "deleted" for a resource it never
	// touched.
	err = ts.DeleteResource(ctx, &store.DeleteResource{
		ID: 2,
	})
	require.Error(t, err)
	ts.Close()
}

func TestResourceStoreBatchByMemoIDList(t *testing.T) {
	ctx := context.Background()
	ts := NewTestingStore(ctx, t)
	defer ts.Close()

	memoID1 := int32(10)
	memoID2 := int32(20)
	memoID3 := int32(30)

	_, err := ts.CreateResource(ctx, &store.Resource{
		CreatorID: 101,
		Filename:  "file1.png",
		MemoID:    &memoID1,
	})
	require.NoError(t, err)

	_, err = ts.CreateResource(ctx, &store.Resource{
		CreatorID: 101,
		Filename:  "file2.png",
		MemoID:    &memoID2,
	})
	require.NoError(t, err)

	_, err = ts.CreateResource(ctx, &store.Resource{
		CreatorID: 101,
		Filename:  "file3.png",
		MemoID:    &memoID3,
	})
	require.NoError(t, err)

	// Query resources belonging to memo 10 and 20
	resources, err := ts.ListResources(ctx, &store.FindResource{
		MemoIDList: []int32{memoID1, memoID2},
	})
	require.NoError(t, err)
	require.Len(t, resources, 2)

	// Query memo relations batch
	_, err = ts.UpsertMemoRelation(ctx, &store.MemoRelation{
		MemoID:        memoID1,
		RelatedMemoID: memoID2,
		Type:          store.MemoRelationReference,
	})
	require.NoError(t, err)

	_, err = ts.UpsertMemoRelation(ctx, &store.MemoRelation{
		MemoID:        memoID2,
		RelatedMemoID: memoID3,
		Type:          store.MemoRelationComment,
	})
	require.NoError(t, err)

	relationsByMemoID, err := ts.ListMemoRelations(ctx, &store.FindMemoRelation{
		MemoIDList: []int32{memoID1, memoID2},
	})
	require.NoError(t, err)
	require.Len(t, relationsByMemoID, 2)

	relationsByRelatedMemoID, err := ts.ListMemoRelations(ctx, &store.FindMemoRelation{
		RelatedMemoIDList: []int32{memoID2, memoID3},
	})
	require.NoError(t, err)
	require.Len(t, relationsByRelatedMemoID, 2)
}
