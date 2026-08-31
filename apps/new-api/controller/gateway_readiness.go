package controller

import (
	"strings"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/gin-gonic/gin"
)

const (
	gatewayReadinessReasonNoEnabledModels      = "no_enabled_models"
	gatewayReadinessReasonNoConfiguredChannels = "no_configured_channels"
	gatewayReadinessReasonNoExecutableModels   = "no_executable_models"
)

type gatewayReadiness struct {
	Ready                  bool     `json:"ready"`
	EnabledModelCount      int      `json:"enabled_model_count"`
	ConfiguredChannelCount int      `json:"configured_channel_count"`
	ExecutableModelCount   int      `json:"executable_model_count"`
	Reasons                []string `json:"reasons"`
}

func channelHasUsableCredential(channel model.Channel) bool {
	keys := channel.GetKeys()
	if len(keys) == 0 {
		return false
	}
	for index, key := range keys {
		if strings.TrimSpace(key) == "" {
			continue
		}
		if !channel.ChannelInfo.IsMultiKey {
			return true
		}
		status, exists := channel.ChannelInfo.MultiKeyStatusList[index]
		if !exists || status == common.ChannelStatusEnabled {
			return true
		}
	}
	return false
}

func buildGatewayReadiness(
	models []model.Model,
	channels []model.Channel,
	abilities []model.Ability,
) gatewayReadiness {
	enabledModels := make(map[string]struct{})
	for _, catalogModel := range models {
		if catalogModel.Status != 1 {
			continue
		}
		canonicalName := model.CanonicalModelKey(catalogModel.ModelName)
		if canonicalName != "" {
			enabledModels[canonicalName] = struct{}{}
		}
	}

	configuredChannelIDs := make(map[int]struct{})
	for _, channel := range channels {
		if channel.Status != common.ChannelStatusEnabled || !channelHasUsableCredential(channel) {
			continue
		}
		configuredChannelIDs[channel.Id] = struct{}{}
	}

	executableModels := make(map[string]struct{})
	for _, ability := range abilities {
		if !ability.Enabled {
			continue
		}
		if _, configured := configuredChannelIDs[ability.ChannelId]; !configured {
			continue
		}
		canonicalName := model.CanonicalModelKey(ability.Model)
		if _, enabled := enabledModels[canonicalName]; enabled {
			executableModels[canonicalName] = struct{}{}
		}
	}

	reasons := make([]string, 0, 3)
	if len(enabledModels) == 0 {
		reasons = append(reasons, gatewayReadinessReasonNoEnabledModels)
	}
	if len(configuredChannelIDs) == 0 {
		reasons = append(reasons, gatewayReadinessReasonNoConfiguredChannels)
	}
	if len(enabledModels) > 0 && len(configuredChannelIDs) > 0 && len(executableModels) == 0 {
		reasons = append(reasons, gatewayReadinessReasonNoExecutableModels)
	}

	return gatewayReadiness{
		Ready:                  len(executableModels) > 0,
		EnabledModelCount:      len(enabledModels),
		ConfiguredChannelCount: len(configuredChannelIDs),
		ExecutableModelCount:   len(executableModels),
		Reasons:                reasons,
	}
}

// GetGatewayReadiness reports only aggregate configuration facts. It never
// returns channel names, credentials, or model keys.
func GetGatewayReadiness(c *gin.Context) {
	var models []model.Model
	if err := model.DB.Where("status = ?", 1).Find(&models).Error; err != nil {
		common.ApiError(c, err)
		return
	}

	var channels []model.Channel
	if err := model.DB.Where("status = ?", common.ChannelStatusEnabled).Find(&channels).Error; err != nil {
		common.ApiError(c, err)
		return
	}

	var abilities []model.Ability
	if err := model.DB.Where("enabled = ?", true).Find(&abilities).Error; err != nil {
		common.ApiError(c, err)
		return
	}

	common.ApiSuccess(c, buildGatewayReadiness(models, channels, abilities))
}
