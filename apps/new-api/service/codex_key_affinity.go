package service

import (
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"strings"
	"sync"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/pkg/cachex"
	"github.com/gin-gonic/gin"
	"github.com/samber/hot"
)

const codexKeyAffinityNamespace = "new-api:codex_key_affinity:v1"

var (
	codexKeyAffinityOnce  sync.Once
	codexKeyAffinityCache *cachex.HybridCache[int]
)

func getCodexKeyAffinityCache() *cachex.HybridCache[int] {
	codexKeyAffinityOnce.Do(func() {
		codexKeyAffinityCache = cachex.NewHybridCache[int](cachex.HybridCacheConfig[int]{
			Namespace:    cachex.Namespace(codexKeyAffinityNamespace),
			Redis:        common.RDB,
			RedisEnabled: func() bool { return common.RedisEnabled && common.RDB != nil },
			RedisCodec:   cachex.IntCodec{},
			Memory: func() *hot.HotCache[string, int] {
				return hot.NewHotCache[string, int](hot.LRU, 100_000).WithTTL(time.Hour).WithJanitor().Build()
			},
		})
	})
	return codexKeyAffinityCache
}

func CodexSessionID(c *gin.Context) string {
	if c == nil || c.Request == nil {
		return ""
	}
	for _, name := range []string{"Session_id", "X-Session-ID"} {
		if value := strings.TrimSpace(c.GetHeader(name)); value != "" {
			return value
		}
	}
	return ""
}

func GetCodexSessionKeyIndex(channelID int, sessionID string) (int, bool) {
	cacheKey := codexKeyAffinityCacheKey(channelID, sessionID)
	if cacheKey == "" {
		return 0, false
	}
	keyIndex, found, err := getCodexKeyAffinityCache().Get(cacheKey)
	if err != nil || !found {
		return 0, false
	}
	return keyIndex, true
}

func BindCodexSessionKey(channelID int, sessionID string, keyIndex int, ttlSeconds int) {
	cacheKey := codexKeyAffinityCacheKey(channelID, sessionID)
	if cacheKey == "" || keyIndex < 0 {
		return
	}
	if ttlSeconds <= 0 {
		ttlSeconds = 3600
	}
	if err := getCodexKeyAffinityCache().SetWithTTL(cacheKey, keyIndex, time.Duration(ttlSeconds)*time.Second); err != nil {
		common.SysError(fmt.Sprintf("codex session affinity cache set failed: channel_id=%d err=%v", channelID, err))
	}
}

func codexKeyAffinityCacheKey(channelID int, sessionID string) string {
	sessionID = strings.TrimSpace(sessionID)
	if channelID <= 0 || sessionID == "" {
		return ""
	}
	digest := sha256.Sum256([]byte(sessionID))
	return fmt.Sprintf("%d:%s", channelID, hex.EncodeToString(digest[:]))
}
