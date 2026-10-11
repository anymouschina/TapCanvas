package controller

import (
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/middleware"
	"github.com/QuantumNous/new-api/model"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	"github.com/QuantumNous/new-api/service"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/require"
)

// A Droid pool preferred for core models must not block the model once every
// account's core scope is spent: the next channel by priority serves it.
func setupDroidScopeFallthroughChannels(t *testing.T, memoryCache bool) (droidID, fallbackID int) {
	t.Helper()
	droidPoolTestDB(t)
	require.NoError(t, model.DB.AutoMigrate(&model.Channel{}, &model.Ability{}))
	oldCache := common.MemoryCacheEnabled
	common.MemoryCacheEnabled = memoryCache
	t.Cleanup(func() { common.MemoryCacheEnabled = oldCache })

	used := float64(100)
	reset := time.Now().Unix() + 3600
	spentCore := model.ChannelKeyUsage{QuotaSource: service.DroidQuotaSource,
		QuotaWindows: []model.ChannelQuotaWindow{{Scope: service.DroidScopeCore, UsedPercent: &used, ResetAt: &reset}}}
	droidID, fallbackID = 9101, 9102
	if memoryCache {
		droidID, fallbackID = 9111, 9112
	}
	baseURL := "http://fixture.invalid"
	droid := model.Channel{Id: droidID, Name: "droid-pool", Type: constant.ChannelTypeDroid, Status: common.ChannelStatusEnabled,
		Key: "fixture-account-a\nfixture-account-b", BaseURL: &baseURL, Models: "deepseek-fixture", Group: "default",
		Priority: common.GetPointer(int64(10)), Setting: common.GetPointer(`{"default_protocol":{"protocol":"droid-chat"}}`),
		ChannelInfo: model.ChannelInfo{IsMultiKey: true, MultiKeySize: 2, MultiKeyMode: constant.MultiKeyModePolling,
			MultiKeyUsage: map[int]model.ChannelKeyUsage{0: spentCore, 1: spentCore}},
	}
	fallback := model.Channel{Id: fallbackID, Name: "paid-fallback", Type: constant.ChannelTypeOpenAI, Status: common.ChannelStatusEnabled,
		Key: "fixture-paid", BaseURL: &baseURL, Models: "deepseek-fixture", Group: "default", Priority: common.GetPointer(int64(0)),
		Setting: common.GetPointer(`{"default_protocol":{"protocol":"openai"}}`)}
	for _, channel := range []*model.Channel{&droid, &fallback} {
		require.NoError(t, model.DB.Create(channel).Error)
		require.NoError(t, model.DB.Create(&model.Ability{Group: "default", Model: "deepseek-fixture", ChannelId: channel.Id,
			Enabled: true, Priority: channel.Priority, Weight: 1}).Error)
	}
	if memoryCache {
		require.NoError(t, model.RefreshChannelCache())
	}
	return droidID, fallbackID
}

func TestDistributePassesSpentDroidScopeToNextChannel(t *testing.T) {
	for _, memoryCache := range []bool{false, true} {
		for _, pinned := range []bool{false, true} {
			t.Run(fmt.Sprintf("cache=%t/pinned=%t", memoryCache, pinned), func(t *testing.T) {
				droidID, fallbackID := setupDroidScopeFallthroughChannels(t, memoryCache)
				router := gin.New()
				router.Use(func(c *gin.Context) {
					c.Set(common.RequestIdKey, "scope-fallthrough")
					common.SetContextKey(c, constant.ContextKeyUsingGroup, "default")
					common.SetContextKey(c, constant.ContextKeyUserGroup, "default")
					if pinned {
						common.SetContextKey(c, constant.ContextKeyTokenSpecificChannelId, fmt.Sprint(droidID))
					}
				})
				router.Use(middleware.Distribute())
				selected := 0
				router.POST("/v1/chat/completions", func(c *gin.Context) {
					selected = common.GetContextKeyInt(c, constant.ContextKeyChannelId)
					c.Status(http.StatusOK)
				})
				recorder := httptest.NewRecorder()
				request := httptest.NewRequest(http.MethodPost, "/v1/chat/completions",
					strings.NewReader(`{"model":"deepseek-fixture","messages":[{"role":"user","content":"fixture"}]}`))
				request.Header.Set("Content-Type", "application/json")
				router.ServeHTTP(recorder, request)
				if pinned {
					require.Equal(t, http.StatusTooManyRequests, recorder.Code, "a pinned channel never leaves its pool")
					require.Zero(t, selected)
					return
				}
				require.Equal(t, http.StatusOK, recorder.Code, recorder.Body.String())
				require.Equal(t, fallbackID, selected)
			})
		}
	}
}

func TestRetryChannelSelectionPassesSpentDroidScope(t *testing.T) {
	for _, memoryCache := range []bool{false, true} {
		t.Run(fmt.Sprintf("cache=%t", memoryCache), func(t *testing.T) {
			_, fallbackID := setupDroidScopeFallthroughChannels(t, memoryCache)
			c, _ := gin.CreateTestContext(httptest.NewRecorder())
			c.Request = httptest.NewRequest(http.MethodPost, "/v1/chat/completions", nil)
			common.SetContextKey(c, constant.ContextKeyUserGroup, "default")
			info := &relaycommon.RelayInfo{OriginModelName: "deepseek-fixture", ChannelMeta: &relaycommon.ChannelMeta{}}
			tried := make([]int, 0, 4)
			param := &service.RetryParam{Ctx: c, TokenGroup: "default", ModelName: "deepseek-fixture", Retry: common.GetPointer(0), ExcludeChannelIds: tried}
			channel, err := getChannel(c, info, param)
			require.Nil(t, err)
			require.Equal(t, fallbackID, channel.Id)
			require.Zero(t, tried[:1][0], "passing over a channel never writes into the caller's tried list")
		})
	}
}
