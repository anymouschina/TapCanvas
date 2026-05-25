package model

import (
	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/setting/ratio_setting"
)

func IsChannelEnabledForGroupModel(group string, modelName string, channelID int) bool {
	if group == "" || modelName == "" || channelID <= 0 {
		return false
	}
	if !common.MemoryCacheEnabled {
		return isChannelEnabledForGroupModelDB(group, modelName, channelID)
	}

	channelSyncLock.RLock()
	defer channelSyncLock.RUnlock()

	if group2model2channels == nil {
		return false
	}

	for _, candidate := range RoutingModelSelectionCandidates(modelName) {
		if isChannelIDInList(group2model2channels[group][candidate], channelID) {
			return true
		}
		normalized := ratio_setting.FormatMatchingModelName(candidate)
		if normalized != "" && normalized != candidate && isChannelIDInList(group2model2channels[group][normalized], channelID) {
			return true
		}
	}
	return false
}

func IsChannelEnabledForAnyGroupModel(groups []string, modelName string, channelID int) bool {
	if len(groups) == 0 {
		return false
	}
	for _, g := range groups {
		if IsChannelEnabledForGroupModel(g, modelName, channelID) {
			return true
		}
	}
	return false
}

func isChannelEnabledForGroupModelDB(group string, modelName string, channelID int) bool {
	var count int64
	for _, candidate := range RoutingModelSelectionCandidates(modelName) {
		err := DB.Model(&Ability{}).
			Where(commonGroupCol+" = ? and model = ? and channel_id = ? and enabled = ?", group, candidate, channelID, true).
			Count(&count).Error
		if err == nil && count > 0 {
			return true
		}
		normalized := ratio_setting.FormatMatchingModelName(candidate)
		if normalized == "" || normalized == candidate {
			continue
		}
		count = 0
		err = DB.Model(&Ability{}).
			Where(commonGroupCol+" = ? and model = ? and channel_id = ? and enabled = ?", group, normalized, channelID, true).
			Count(&count).Error
		if err == nil && count > 0 {
			return true
		}
	}
	return false
}

func isChannelIDInList(list []int, channelID int) bool {
	for _, id := range list {
		if id == channelID {
			return true
		}
	}
	return false
}
