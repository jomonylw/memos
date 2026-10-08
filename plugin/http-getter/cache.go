package getter

import (
	"sync"
	"time"
)

type metaCacheItem struct {
	meta      *HTMLMeta
	expiresAt time.Time
}

var (
	metaCacheLock sync.RWMutex
	metaCache     = make(map[string]metaCacheItem)
)

func getCachedMeta(urlStr string) (*HTMLMeta, bool) {
	metaCacheLock.RLock()
	defer metaCacheLock.RUnlock()

	item, exists := metaCache[urlStr]
	if !exists || time.Now().After(item.expiresAt) {
		return nil, false
	}
	return item.meta, true
}

func setCachedMeta(urlStr string, meta *HTMLMeta) {
	metaCacheLock.Lock()
	defer metaCacheLock.Unlock()

	if len(metaCache) > 2000 {
		now := time.Now()
		for k, v := range metaCache {
			if now.After(v.expiresAt) {
				delete(metaCache, k)
			}
		}
	}

	metaCache[urlStr] = metaCacheItem{
		meta:      meta,
		expiresAt: time.Now().Add(24 * time.Hour),
	}
}
