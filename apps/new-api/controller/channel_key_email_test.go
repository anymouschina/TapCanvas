package controller

import (
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/model"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/require"
)

func TestAppendAPIKeyEmailPersistsWithoutChangingCredentialsOrExistingAnnotations(t *testing.T) {
	droidPoolTestDB(t)
	channel := multiKeyReliabilityFixture(t, common.ChannelStatusEnabled)
	channel.Type = constant.ChannelTypeDroid
	setting := `{"default_protocol":{"protocol":"droid-chat"}}`
	channel.Setting = &setting
	channel.ChannelInfo.MultiKeyEmail = map[int]string{0: "original@example.com"}
	require.NoError(t, channel.Update())
	appendMode, email := "append", "  New.User@example.com  "
	request := PatchChannel{Channel: model.Channel{Id: channel.Id, Type: channel.Type, Key: "account-a\naccount-d\naccount-d\naccount-e"}, KeyMode: &appendMode, KeyEmail: &email}
	payload, err := common.Marshal(request)
	require.NoError(t, err)
	runMultiKeyHandler(t, payload, UpdateChannel)
	stored, err := model.GetChannelById(channel.Id, true)
	require.NoError(t, err)
	require.Equal(t, []string{"account-a", "account-b", "account-c", "account-d", "account-e"}, stored.GetKeys())
	require.Equal(t, map[int]string{0: "original@example.com", 3: "New.User@example.com", 4: "New.User@example.com"}, stored.ChannelInfo.MultiKeyEmail)
	// A retry is idempotent, and a later blank annotation retains existing labels.
	runMultiKeyHandler(t, payload, UpdateChannel)
	email = " "
	payload, err = common.Marshal(request)
	require.NoError(t, err)
	runMultiKeyHandler(t, payload, UpdateChannel)
	stored, err = model.GetChannelById(channel.Id, true)
	require.NoError(t, err)
	require.Len(t, stored.GetKeys(), 5)
	require.Equal(t, "New.User@example.com", stored.ChannelInfo.MultiKeyEmail[3])
}

func TestPrepareAPIKeyEmailRejectsInvalidAnnotationsAndStructuredCredentials(t *testing.T) {
	original := &model.Channel{ChannelInfo: model.ChannelInfo{IsMultiKey: true}}
	appendMode := "append"
	for _, invalid := range []string{"invalid", "Name <user@example.com>", "user@example.com\nother@example.com"} {
		request := &PatchChannel{Channel: model.Channel{Key: "account-a"}, KeyMode: &appendMode, KeyEmail: &invalid}
		_, _, err := prepareAPIKeyEmail(request, original)
		require.EqualError(t, err, "请输入有效邮箱地址")
	}
	email := "user@example.com"
	request := &PatchChannel{Channel: model.Channel{Key: `{"access_token":"test"}`}, KeyMode: &appendMode, KeyEmail: &email}
	_, _, err := prepareAPIKeyEmail(request, original)
	require.EqualError(t, err, "邮箱注释仅支持裸 API Key，账号 JSON 使用自身邮箱字段")
	request.Key = "account-a"
	request.KeyMode = nil
	_, _, err = prepareAPIKeyEmail(request, original)
	require.EqualError(t, err, "邮箱注释仅支持追加 API Key 到现有号池")
}

func TestManageMultiKeyEmailFilterRunsBeforePaginationAndKeepsGlobalStats(t *testing.T) {
	droidPoolTestDB(t)
	channel := multiKeyReliabilityFixture(t, common.ChannelStatusEnabled)
	channel.ChannelInfo.MultiKeyEmail = map[int]string{0: "first@example.com", 1: "Target@example.com", 2: "TARGET@other.com"}
	channel.ChannelInfo.MultiKeyStatusList = map[int]int{0: common.ChannelStatusEnabled, 1: common.ChannelStatusManuallyDisabled, 2: common.ChannelStatusEnabled}
	require.NoError(t, channel.Update())
	query := MultiKeyManageRequest{ChannelId: channel.Id, Action: "get_key_status", Email: " TaRgEt ", Page: 2, PageSize: 1}
	response := queryEmailFilteredKeys(t, query)
	require.Equal(t, 2, response.Total)
	require.Equal(t, 2, response.TotalPages)
	require.Equal(t, 2, response.Page)
	require.Len(t, response.Keys, 1)
	require.Equal(t, 2, response.Keys[0].Index)
	require.Equal(t, "TARGET@other.com", response.Keys[0].Email)
	require.False(t, response.Keys[0].IsOAuth)
	require.Equal(t, 2, response.EnabledCount)
	require.Equal(t, 1, response.ManualDisabledCount)
	status := common.ChannelStatusManuallyDisabled
	query.Status = &status
	response = queryEmailFilteredKeys(t, query)
	require.Equal(t, 1, response.Total)
	require.Equal(t, 1, response.Page)
	require.Equal(t, 1, response.Keys[0].Index)
	require.Equal(t, 2, response.EnabledCount)
	query.Email = "no-match"
	response = queryEmailFilteredKeys(t, query)
	require.Zero(t, response.Total)
	require.Empty(t, response.Keys)
}

func queryEmailFilteredKeys(t *testing.T, request MultiKeyManageRequest) MultiKeyStatusResponse {
	t.Helper()
	payload, err := common.Marshal(request)
	require.NoError(t, err)
	recorder := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(recorder)
	c.Request = httptest.NewRequest("POST", "/api/channel/multi_key/manage", strings.NewReader(string(payload)))
	c.Request.Header.Set("Content-Type", "application/json")
	ManageMultiKeys(c)
	var response struct {
		Success bool                   `json:"success"`
		Data    MultiKeyStatusResponse `json:"data"`
	}
	require.NoError(t, common.Unmarshal(recorder.Body.Bytes(), &response))
	require.True(t, response.Success)
	return response.Data
}
