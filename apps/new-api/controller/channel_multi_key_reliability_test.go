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

func TestUpdateChannelMultiKeyReplacementRemapsUsageBeforeDisplay(t *testing.T) {
	for _, channelType := range []int{constant.ChannelTypeOpenAI, constant.ChannelTypeDroid} {
		t.Run(string(rune(channelType)), func(t *testing.T) {
			droidPoolTestDB(t)
			channel := multiKeyReliabilityFixture(t, common.ChannelStatusEnabled)
			channel.Type = channelType
			if channelType == constant.ChannelTypeDroid {
				raw := `{"default_protocol":{"protocol":"droid-chat"}}`
				channel.Setting = &raw
			}
			require.NoError(t, channel.Update())
			mode := "replace"
			payload, err := common.Marshal(PatchChannel{Channel: model.Channel{Id: channel.Id, Type: channel.Type, Key: "account-b\nnew-account\naccount-c"}, KeyMode: &mode})
			require.NoError(t, err)
			runMultiKeyHandler(t, payload, UpdateChannel)
			stored, err := model.GetChannelById(channel.Id, true)
			require.NoError(t, err)
			require.Equal(t, "b", stored.ChannelInfo.MultiKeyUsage[0].PlanType)
			require.Equal(t, "c", stored.ChannelInfo.MultiKeyUsage[2].PlanType)
			_, exists := stored.ChannelInfo.MultiKeyUsage[1]
			require.False(t, exists, "new credential cannot inherit a snapshot before quota refresh")
			body, err := common.Marshal(MultiKeyManageRequest{ChannelId: channel.Id, Action: "get_key_status"})
			require.NoError(t, err)
			recorder := httptest.NewRecorder()
			c, _ := gin.CreateTestContext(recorder)
			c.Request = httptest.NewRequest("POST", "/api/channel/multi_key/manage", strings.NewReader(string(body)))
			c.Request.Header.Set("Content-Type", "application/json")
			ManageMultiKeys(c)
			var response struct {
				Success bool                   `json:"success"`
				Data    MultiKeyStatusResponse `json:"data"`
			}
			require.NoError(t, common.Unmarshal(recorder.Body.Bytes(), &response))
			require.True(t, response.Success)
			require.Len(t, response.Data.Keys, 3)
			require.Equal(t, "b", response.Data.Keys[0].Usage.PlanType)
			require.Nil(t, response.Data.Keys[1].Usage)
			require.Equal(t, common.ChannelStatusEnabled, response.Data.Keys[1].Status)
		})
	}
}

func runMultiKeyHandler(t *testing.T, payload []byte, handler gin.HandlerFunc) {
	t.Helper()
	response := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(response)
	c.Request = httptest.NewRequest("POST", "/api/channel/multi_key/manage", strings.NewReader(string(payload)))
	c.Request.Header.Set("Content-Type", "application/json")
	handler(c)
	var result struct {
		Success bool   `json:"success"`
		Message string `json:"message"`
	}
	require.Equal(t, 200, response.Code)
	require.NoError(t, common.Unmarshal(response.Body.Bytes(), &result))
	require.True(t, result.Success, result.Message)
}

func multiKeyReliabilityFixture(t *testing.T, status int) model.Channel {
	t.Helper()
	channel := insertDroidPoolFixture(t)
	channel.Key = "account-a\naccount-b\naccount-c"
	channel.Status = status
	channel.ChannelInfo = model.ChannelInfo{IsMultiKey: true, MultiKeySize: 3,
		MultiKeyStatusList: map[int]int{0: 3, 1: 3, 2: 3},
		MultiKeyUsage:      map[int]model.ChannelKeyUsage{0: {PlanType: "a"}, 1: {PlanType: "b"}, 2: {PlanType: "c"}},
	}
	require.NoError(t, channel.Update())
	return channel
}

func TestManageMultiKeyEnableRestoresOnlyAutomaticChannelDisable(t *testing.T) {
	for _, action := range []string{"enable_key", "enable_all_keys"} {
		for _, status := range []int{common.ChannelStatusAutoDisabled, common.ChannelStatusManuallyDisabled} {
			t.Run(action+"/"+string(rune('0'+status)), func(t *testing.T) {
				droidPoolTestDB(t)
				channel := multiKeyReliabilityFixture(t, status)
				common.MemoryCacheEnabled = true
				require.NoError(t, model.RefreshChannelCache())
				index := 1
				payload, err := common.Marshal(MultiKeyManageRequest{ChannelId: channel.Id, Action: action, KeyIndex: &index})
				require.NoError(t, err)
				runMultiKeyHandler(t, payload, ManageMultiKeys)
				stored, err := model.GetChannelById(channel.Id, true)
				require.NoError(t, err)
				wantStatus := status
				if status == common.ChannelStatusAutoDisabled {
					wantStatus = common.ChannelStatusEnabled
				}
				require.Equal(t, wantStatus, stored.Status)
				cached, err := model.CacheGetChannel(channel.Id)
				require.NoError(t, err)
				require.Equal(t, wantStatus, cached.Status)
				var abilities []model.Ability
				require.NoError(t, model.DB.Where("channel_id = ?", channel.Id).Find(&abilities).Error)
				require.NotEmpty(t, abilities)
				for _, ability := range abilities {
					require.Equal(t, wantStatus == common.ChannelStatusEnabled, ability.Enabled)
				}
			})
		}
	}
}

func TestAppendMultiKeyRestoresOnlyAutomaticChannelDisable(t *testing.T) {
	for _, status := range []int{common.ChannelStatusAutoDisabled, common.ChannelStatusManuallyDisabled} {
		t.Run(string(rune('0'+status)), func(t *testing.T) {
			droidPoolTestDB(t)
			channel := multiKeyReliabilityFixture(t, status)
			appendMode := "append"
			payload, err := common.Marshal(PatchChannel{Channel: model.Channel{Id: channel.Id, Type: channel.Type, Key: "account-d"}, KeyMode: &appendMode})
			require.NoError(t, err)
			runMultiKeyHandler(t, payload, UpdateChannel)
			stored, err := model.GetChannelById(channel.Id, true)
			require.NoError(t, err)
			require.Equal(t, []string{"account-a", "account-b", "account-c", "account-d"}, stored.GetKeys())
			wantStatus := status
			if status == common.ChannelStatusAutoDisabled {
				wantStatus = common.ChannelStatusEnabled
			}
			require.Equal(t, wantStatus, stored.Status)
			var abilities []model.Ability
			require.NoError(t, model.DB.Where("channel_id = ?", channel.Id).Find(&abilities).Error)
			require.NotEmpty(t, abilities)
			for _, ability := range abilities {
				require.Equal(t, wantStatus == common.ChannelStatusEnabled, ability.Enabled)
			}
		})
	}
}

func TestManageMultiKeyDeletionPreservesUsageAndReceiptIdentity(t *testing.T) {
	for _, action := range []string{"delete_key", "delete_disabled_keys"} {
		t.Run(action, func(t *testing.T) {
			droidPoolTestDB(t)
			channel := multiKeyReliabilityFixture(t, common.ChannelStatusEnabled)
			channel.ChannelInfo.MultiKeyStatusList = map[int]int{0: common.ChannelStatusAutoDisabled}
			require.NoError(t, channel.Update())
			index := 0
			payload, err := common.Marshal(MultiKeyManageRequest{ChannelId: channel.Id, Action: action, KeyIndex: &index})
			require.NoError(t, err)
			runMultiKeyHandler(t, payload, ManageMultiKeys)
			stored, err := model.GetChannelById(channel.Id, true)
			require.NoError(t, err)
			require.Equal(t, []string{"account-b", "account-c"}, stored.GetKeys())
			require.Equal(t, "b", stored.ChannelInfo.MultiKeyUsage[0].PlanType)
			require.Equal(t, "c", stored.ChannelInfo.MultiKeyUsage[1].PlanType)
			require.False(t, model.UpdateChannelStatusWithKeyIndex(channel.Id, "account-a", 0, common.ChannelStatusAutoDisabled, "old failed request"))
			require.True(t, model.UpdateChannelStatusWithKeyIndex(channel.Id, "account-b", 1, common.ChannelStatusAutoDisabled, "shifted account failed"))
			stored, err = model.GetChannelById(channel.Id, true)
			require.NoError(t, err)
			require.Equal(t, common.ChannelStatusAutoDisabled, stored.ChannelInfo.MultiKeyStatusList[0])
			require.NotContains(t, stored.ChannelInfo.MultiKeyStatusList, 1)
		})
	}
}
