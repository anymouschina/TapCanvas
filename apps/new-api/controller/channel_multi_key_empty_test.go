package controller

import (
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/model"
	"github.com/stretchr/testify/require"
)

func TestManageMultiKeyEmptyDroidPoolReturnsEmptyArray(t *testing.T) {
	droidPoolTestDB(t)
	channel := insertEmptyDroidPoolFixture(t)

	response := queryEmailFilteredKeys(t, MultiKeyManageRequest{
		ChannelId: channel.Id, Action: "get_key_status",
	})

	require.NotNil(t, response.Keys, "the response must encode keys as [] rather than null")
	require.Empty(t, response.Keys)
	require.Zero(t, response.Total)
	require.Equal(t, 1, response.Page)
	require.Equal(t, 50, response.PageSize)
	require.Equal(t, 1, response.TotalPages)
	require.Zero(t, response.EnabledCount)
	require.Zero(t, response.ManualDisabledCount)
	require.Zero(t, response.AutoDisabledCount)
}

func TestManageMultiKeyUnmatchedDroidFiltersReturnEmptyArray(t *testing.T) {
	for _, filter := range []string{"status", "email"} {
		t.Run(filter, func(t *testing.T) {
			droidPoolTestDB(t)
			channel := insertEmptyDroidPoolFixture(t)
			channel.Key = "fixture-account"
			channel.ChannelInfo.MultiKeyEmail = map[int]string{0: "fixture@example.com"}
			require.NoError(t, channel.Update())
			request := MultiKeyManageRequest{
				ChannelId: channel.Id, Action: "get_key_status", Page: 3, PageSize: 10,
			}
			if filter == "status" {
				status := common.ChannelStatusManuallyDisabled
				request.Status = &status
			} else {
				request.Email = "missing@example.com"
			}

			response := queryEmailFilteredKeys(t, request)

			require.NotNil(t, response.Keys, "the response must encode keys as [] rather than null")
			require.Empty(t, response.Keys)
			require.Zero(t, response.Total)
			require.Equal(t, 1, response.Page)
			require.Equal(t, 10, response.PageSize)
			require.Equal(t, 1, response.TotalPages)
			require.Equal(t, 1, response.EnabledCount, "filtering must preserve pool statistics")
			require.Zero(t, response.ManualDisabledCount)
			require.Zero(t, response.AutoDisabledCount)
		})
	}
}

func TestAppendKeyToEmptyDroidPoolPreservesManualDisable(t *testing.T) {
	for _, configuration := range []string{"sql_seed", "configured_model_pool"} {
		t.Run(configuration, func(t *testing.T) {
			droidPoolTestDB(t)
			var channel model.Channel
			if configuration == "sql_seed" {
				setting := `{"model_protocols":{}}`
				channel = model.Channel{
					Type: constant.ChannelTypeDroid, Key: "", Name: "seed-droid-pool-fixture",
					Models: "", Group: "default", Status: common.ChannelStatusManuallyDisabled,
					Setting: &setting,
					ChannelInfo: model.ChannelInfo{
						IsMultiKey: true, MultiKeySize: 0, MultiKeyMode: constant.MultiKeyModePolling,
					},
				}
				// Match the seed's direct INSERT, which creates no ability rows.
				require.NoError(t, model.DB.Create(&channel).Error)
			} else {
				channel = insertEmptyDroidPoolFixture(t)
			}
			var initialAbilities []model.Ability
			require.NoError(t, model.DB.Where("channel_id = ?", channel.Id).Find(&initialAbilities).Error)
			if configuration == "sql_seed" {
				require.Empty(t, initialAbilities)
			} else {
				require.Len(t, initialAbilities, 1)
			}

			appendMode := "append"
			payload, err := common.Marshal(PatchChannel{
				Channel: model.Channel{Id: channel.Id, Type: channel.Type, Key: "fixture-account"},
				KeyMode: &appendMode,
			})
			require.NoError(t, err)
			runMultiKeyHandler(t, payload, UpdateChannel)

			stored, err := model.GetChannelById(channel.Id, true)
			require.NoError(t, err)
			require.Equal(t, []string{"fixture-account"}, stored.GetKeys())
			require.True(t, stored.ChannelInfo.IsMultiKey)
			require.Equal(t, 1, stored.ChannelInfo.MultiKeySize)
			require.Equal(t, common.ChannelStatusManuallyDisabled, stored.Status)
			require.Equal(t, channel.Models, stored.Models)
			require.Equal(t, channel.Setting, stored.Setting)
			var enabledAbilityCount int64
			require.NoError(t, model.DB.Model(&model.Ability{}).
				Where("channel_id = ? AND enabled = ?", channel.Id, true).
				Count(&enabledAbilityCount).Error)
			require.Zero(t, enabledAbilityCount)

			response := queryEmailFilteredKeys(t, MultiKeyManageRequest{
				ChannelId: channel.Id, Action: "get_key_status",
			})
			require.Len(t, response.Keys, 1)
			require.Equal(t, 1, response.Total)
			require.Equal(t, 1, response.EnabledCount)
		})
	}
}

func insertEmptyDroidPoolFixture(t *testing.T) model.Channel {
	t.Helper()
	setting := `{"default_protocol":{"protocol":"droid-chat"}}`
	channel := model.Channel{
		Type: constant.ChannelTypeDroid, Key: "", Name: "empty-droid-pool-fixture",
		Models: "fixture-model", Group: "default", Status: common.ChannelStatusManuallyDisabled,
		Setting: &setting,
		ChannelInfo: model.ChannelInfo{
			IsMultiKey: true, MultiKeySize: 0, MultiKeyMode: constant.MultiKeyModePolling,
		},
	}
	require.NoError(t, channel.Insert())
	return channel
}
