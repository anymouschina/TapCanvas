package controller

import (
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/dto"
	"github.com/QuantumNous/new-api/middleware"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/service"
	"github.com/QuantumNous/new-api/setting/operation_setting"
	"github.com/QuantumNous/new-api/setting/ratio_setting"
	"github.com/QuantumNous/new-api/types"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/require"
)

const droidQuotaRejectionFixture = `{"detail":"fixture account quota exhausted","status":402,"title":"Payment Required"}`

func TestDroidRelayFirstSelectionAndSiblingQuotaRotation(t *testing.T) {
	for firstIndex := 0; firstIndex < 2; firstIndex++ {
		for _, outcome := range []string{"success", "exhausted", "accepted_failure", "reorder", "delete_sibling"} {
			t.Run(fmt.Sprintf("first=%d/%s", firstIndex, outcome), func(t *testing.T) {
				droidPoolTestDB(t)
				require.NoError(t, model.DB.AutoMigrate(&model.User{}, &model.Token{}, &model.Log{}, &model.RequestTrace{}))
				user := model.User{Username: "droid-fixture", Quota: 1000}
				require.NoError(t, model.DB.Create(&user).Error)
				token := model.Token{UserId: user.Id, Key: "fixture-client-key", Status: common.TokenStatusEnabled, RemainQuota: 1000, ExpiredTime: -1}
				require.NoError(t, model.DB.Create(&token).Error)
				oldRetry, oldBatch := common.RetryTimes, common.BatchUpdateEnabled
				common.RetryTimes, common.BatchUpdateEnabled = 0, false
				oldRanges := operation_setting.AutomaticRetryStatusCodeRanges
				operation_setting.AutomaticRetryStatusCodeRanges = nil
				oldPrice := ratio_setting.ModelPrice2JSONString()
				require.NoError(t, ratio_setting.UpdateModelPriceByJSONString(`{"droid-fixture":0}`))
				t.Cleanup(func() {
					common.RetryTimes, common.BatchUpdateEnabled = oldRetry, oldBatch
					operation_setting.AutomaticRetryStatusCodeRanges = oldRanges
					require.NoError(t, ratio_setting.UpdateModelPriceByJSONString(oldPrice))
				})
				service.InitHttpClient()
				keys := []string{"fixture-account-a", "fixture-account-b"}
				var lock sync.Mutex
				var calls, bodies []string
				var fixtureChannelID int
				upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
					w.Header().Set("Content-Type", "application/json")
					if !strings.HasPrefix(r.URL.Path, "/api/llm/") {
						w.WriteHeader(http.StatusNotFound)
						return
					}
					body, err := io.ReadAll(r.Body)
					require.NoError(t, err)
					lock.Lock()
					calls = append(calls, r.Header.Get("Authorization"))
					bodies = append(bodies, string(body))
					lock.Unlock()
					if outcome == "accepted_failure" {
						fmt.Fprint(w, "invalid JSON after HTTP 200")
						return
					}
					if (outcome == "reorder" || outcome == "delete_sibling") && r.Header.Get("Authorization") == "Bearer "+keys[firstIndex] {
						poolLock := model.GetChannelPollingLock(fixtureChannelID)
						poolLock.Lock()
						current, loadErr := model.GetChannelById(fixtureChannelID, true)
						require.NoError(t, loadErr)
						if outcome == "reorder" {
							current.RetainMultiKeys([]int{1, 0})
						} else {
							current.RetainMultiKeys([]int{firstIndex})
						}
						require.NoError(t, current.Update())
						require.NoError(t, model.RefreshChannelCache())
						poolLock.Unlock()
					}
					if outcome == "exhausted" || r.Header.Get("Authorization") == "Bearer "+keys[firstIndex] {
						w.WriteHeader(http.StatusPaymentRequired)
						fmt.Fprint(w, droidQuotaRejectionFixture)
						return
					}
					fmt.Fprint(w, `{"id":"fixture-result","object":"chat.completion","model":"droid-fixture","choices":[{"index":0,"message":{"role":"assistant","content":"sibling-account-success"},"finish_reason":"stop"}],"usage":{"prompt_tokens":10,"completion_tokens":2,"total_tokens":12}}`)
				}))
				defer upstream.Close()
				channelID := 8100 + firstIndex*10
				if outcome == "exhausted" {
					channelID++
				}
				if outcome == "accepted_failure" {
					channelID += 2
				}
				if outcome == "reorder" {
					channelID += 3
				}
				if outcome == "delete_sibling" {
					channelID += 4
				}
				fixtureChannelID = channelID
				channel := model.Channel{Id: channelID, Name: "droid-fixture", Type: constant.ChannelTypeDroid, Status: common.ChannelStatusEnabled,
					Key: strings.Join(keys, "\n"), BaseURL: &upstream.URL, Models: "droid-fixture", Group: "default", AutoBan: common.GetPointer(1),
					Setting:     common.GetPointer(`{"default_protocol":{"protocol":"droid-chat"}}`),
					ChannelInfo: model.ChannelInfo{IsMultiKey: true, MultiKeySize: 2, MultiKeyMode: constant.MultiKeyModePolling, MultiKeyPollingIndex: firstIndex}}
				require.NoError(t, model.DB.Create(&channel).Error)
				require.NoError(t, model.DB.Create(&model.Ability{Group: "default", Model: "droid-fixture", ChannelId: channel.Id, Enabled: true, Weight: 1}).Error)
				recorder := httptest.NewRecorder()
				c, _ := gin.CreateTestContext(recorder)
				c.Request = httptest.NewRequest(http.MethodPost, "/v1/chat/completions", strings.NewReader(`{"model":"droid-fixture","messages":[{"role":"user","content":"fixture"}],"stream":false}`))
				c.Request.Header.Set("Content-Type", "application/json")
				c.Set("id", user.Id)
				c.Set("token_id", token.Id)
				c.Set("token_key", token.Key)
				c.Set("user_quota", user.Quota)
				c.Set("user_group", "default")
				c.Set("token_group", "default")
				c.Set("group", "default")
				c.Set(common.RequestIdKey, "droid-pool-fixture")
				common.SetContextKey(c, constant.ContextKeyUserSetting, dto.UserSetting{BillingPreference: "wallet_only"})
				require.Nil(t, middleware.SetupContextForSelectedChannel(c, &channel, "droid-fixture"))
				require.Equal(t, firstIndex, common.GetContextKeyInt(c, constant.ContextKeyChannelMultiKeyIndex))
				Relay(c, types.RelayFormatOpenAI)
				common.CleanupBodyStorage(c)
				lock.Lock()
				observedCalls, observedBodies := append([]string(nil), calls...), append([]string(nil), bodies...)
				lock.Unlock()
				if outcome == "accepted_failure" {
					require.Equal(t, []string{"Bearer " + keys[firstIndex]}, observedCalls)
					require.NotEqual(t, http.StatusOK, recorder.Code)
					return
				}
				if outcome == "delete_sibling" {
					require.Equal(t, []string{"Bearer " + keys[firstIndex]}, observedCalls, "a deleted sibling cannot be dispatched from the old pool")
					require.Equal(t, http.StatusPaymentRequired, recorder.Code)
					require.Eventually(t, func() bool {
						stored, err := model.GetChannelById(channel.Id, true)
						return err == nil && len(stored.ChannelInfo.MultiKeyUsage) == 1
					}, 3*time.Second, 10*time.Millisecond)
					waitDroidPoolRefreshPersistence(channel.Id)
					return
				}
				require.Equal(t, []string{"Bearer " + keys[firstIndex], "Bearer " + keys[1-firstIndex]}, observedCalls, "selected account is dispatched first, then each sibling once")
				require.Equal(t, observedBodies[0], observedBodies[1], "rotation keeps the same model and request")
				require.Eventually(t, func() bool {
					stored, err := model.GetChannelById(channel.Id, true)
					return err == nil && len(stored.ChannelInfo.MultiKeyUsage) == 2
				}, 3*time.Second, 10*time.Millisecond)
				waitDroidPoolRefreshPersistence(channel.Id)
				stored, err := model.GetChannelById(channel.Id, true)
				require.NoError(t, err)
				require.Equal(t, common.ChannelStatusEnabled, stored.Status, "per-scope quota exhaustion cannot disable the account pool")
				require.Empty(t, stored.ChannelInfo.MultiKeyStatusList)
				if outcome == "success" || outcome == "reorder" {
					require.Equal(t, http.StatusOK, recorder.Code, recorder.Body.String())
					require.Contains(t, recorder.Body.String(), "sibling-account-success")
				} else {
					require.Equal(t, http.StatusPaymentRequired, recorder.Code)
					require.Contains(t, recorder.Body.String(), "当前账号的 Droid 额度不足")
					require.Equal(t, 1, strings.Count(recorder.Body.String(), "request id:"))
				}
			})
		}
	}
}

func TestDroidAccountTestUsesOnlyChosenCredentialAndOneRequestID(t *testing.T) {
	droidPoolTestDB(t)
	require.NoError(t, model.DB.AutoMigrate(&model.RequestTrace{}, &model.User{}))
	require.NoError(t, model.DB.Create(&model.User{Id: 1, Username: "test-root", Group: "default", Quota: 1000}).Error)
	oldPrice := ratio_setting.ModelPrice2JSONString()
	require.NoError(t, ratio_setting.UpdateModelPriceByJSONString(`{"droid-fixture":0}`))
	t.Cleanup(func() { require.NoError(t, ratio_setting.UpdateModelPriceByJSONString(oldPrice)) })
	service.InitHttpClient()
	var calls []string
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls = append(calls, r.Header.Get("Authorization"))
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusPaymentRequired)
		fmt.Fprint(w, droidQuotaRejectionFixture)
	}))
	defer upstream.Close()
	channel := model.Channel{Name: "droid-fixed-fixture", Type: constant.ChannelTypeDroid, Status: common.ChannelStatusEnabled, Key: "fixture-a\nfixture-b", BaseURL: &upstream.URL, Models: "droid-fixture", Group: "default", Setting: common.GetPointer(`{"default_protocol":{"protocol":"droid-chat"}}`), ChannelInfo: model.ChannelInfo{IsMultiKey: true, MultiKeySize: 2}}
	require.NoError(t, model.DB.Create(&channel).Error)
	recorder := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(recorder)
	c.Request = httptest.NewRequest(http.MethodPost, "/api/channel/test/1/account-chat", strings.NewReader(`{"key_index":1,"model":"droid-fixture","prompt":"fixture"}`))
	c.Request.Header.Set("Content-Type", "application/json")
	c.Params = gin.Params{{Key: "id", Value: fmt.Sprint(channel.Id)}}
	TestMultiKeyAccountChat(c)
	var response struct {
		Success bool   `json:"success"`
		Message string `json:"message"`
	}
	require.NoError(t, common.Unmarshal(recorder.Body.Bytes(), &response))
	require.False(t, response.Success)
	require.Equal(t, []string{"Bearer fixture-b"}, calls)
	require.Contains(t, response.Message, "当前账号的 Droid 额度不足")
	require.Equal(t, 1, strings.Count(response.Message, "request id:"))
	require.NotContains(t, response.Message, "fixture account quota exhausted")

}

func TestDroidSelectedCredentialDeletedBeforeDispatchIsRejected(t *testing.T) {
	droidPoolTestDB(t)
	channel := model.Channel{Name: "before-dispatch", Type: constant.ChannelTypeDroid, Status: common.ChannelStatusEnabled, Key: "fixture-a\nfixture-b", Models: "droid-fixture", Group: "default", Setting: common.GetPointer(`{"default_protocol":{"protocol":"droid-chat"}}`), ChannelInfo: model.ChannelInfo{IsMultiKey: true, MultiKeySize: 2, MultiKeyMode: constant.MultiKeyModePolling}}
	require.NoError(t, model.DB.Create(&channel).Error)
	c, _ := gin.CreateTestContext(httptest.NewRecorder())
	c.Request = httptest.NewRequest(http.MethodPost, "/v1/chat/completions", nil)
	require.Nil(t, middleware.SetupContextForSelectedChannel(c, &channel, "droid-fixture"))
	require.Equal(t, "fixture-a", common.GetContextKeyString(c, constant.ContextKeyChannelKey))
	channel.RetainMultiKeys([]int{1})
	require.NoError(t, channel.Update())
	_, err := validateSelectedCredential(c, &channel)
	require.NotNil(t, err)
	require.True(t, types.IsSkipRetryError(err))
	require.Contains(t, err.Error(), "removed or disabled before dispatch")
}

func TestSelectedSingleKeyPreservesMultilineJSONCredential(t *testing.T) {
	droidPoolTestDB(t)
	credential := "{\n  \"type\": \"service_account\",\n  \"project_id\": \"fixture-project\",\n  \"private_key\": \"fixture-private-key\"\n}"
	channel := model.Channel{Name: "single-json", Type: constant.ChannelTypeVertexAi, Status: common.ChannelStatusEnabled, Key: credential, Models: "fixture-model", Group: "default", Other: `{"default":"us-central1"}`, Setting: common.GetPointer(`{"default_protocol":{"protocol":"vertex-ai"}}`)}
	require.NoError(t, model.DB.Create(&channel).Error)
	c, _ := gin.CreateTestContext(httptest.NewRecorder())
	c.Request = httptest.NewRequest(http.MethodPost, "/v1/chat/completions", nil)
	require.Nil(t, middleware.SetupContextForSelectedChannel(c, &channel, "fixture-model"))
	current, err := validateSelectedCredential(c, &channel)
	require.Nil(t, err)
	require.Equal(t, credential, current.Key)
	require.Equal(t, credential, common.GetContextKeyString(c, constant.ContextKeyChannelKey))
}

func TestSelectedChannelConfigurationChangeFailsBeforeDispatch(t *testing.T) {
	droidPoolTestDB(t)
	channel := insertDroidPoolFixture(t)
	channel.Setting = common.GetPointer(`{"default_protocol":{"protocol":"openai"}}`)
	require.NoError(t, channel.Update())
	c, _ := gin.CreateTestContext(httptest.NewRecorder())
	c.Request = httptest.NewRequest(http.MethodPost, "/v1/chat/completions", nil)
	require.Nil(t, middleware.SetupContextForSelectedChannel(c, &channel, "fixture-model"))
	for _, testCase := range []struct {
		name   string
		mutate func(*model.Channel)
	}{
		{"type", func(current *model.Channel) { current.Type = constant.ChannelTypeDroid }},
		{"binding", func(current *model.Channel) {
			current.Setting = common.GetPointer(`{"default_protocol":{"protocol":"openai-response"}}`)
		}},
		{"multi-key mode", func(current *model.Channel) {
			current.ChannelInfo.IsMultiKey = true
			current.ChannelInfo.MultiKeySize = 1
		}},
	} {
		t.Run(testCase.name, func(t *testing.T) {
			current := channel
			testCase.mutate(&current)
			require.NoError(t, model.DB.Save(&current).Error)
			_, err := validateSelectedCredential(c, &channel)
			require.NotNil(t, err)
			require.Equal(t, types.ErrorCodeChannelProtocolInvalid, err.GetErrorCode())
			require.True(t, types.IsSkipRetryError(err))
			require.Contains(t, err.Error(), "configuration changed before dispatch")
		})
	}
}

// Usage is saved before cache refresh. Crossing the same polling lock after
// observing the saved snapshot waits for both writes to finish before globals
// and the fixture database are restored.
func waitDroidPoolRefreshPersistence(channelID int) {
	lock := model.GetChannelPollingLock(channelID)
	lock.Lock()
	lock.Unlock()
}
