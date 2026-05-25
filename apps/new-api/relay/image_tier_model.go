package relay

import (
	"encoding/json"
	"fmt"
	"strings"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/dto"
	"github.com/QuantumNous/new-api/model"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	"github.com/QuantumNous/new-api/relay/helper"
	"github.com/gin-gonic/gin"
)

const gptImage2CanonicalModel = "gpt-image-2"
const gptImage2OfficialModel = "gpt-image-2-official"

func applyChannelBoundImageModel(c *gin.Context, info *relaycommon.RelayInfo, request *dto.ImageRequest) error {
	if info == nil || request == nil {
		return nil
	}
	if info.ChannelMeta == nil {
		info.ChannelMeta = &relaycommon.ChannelMeta{}
	}
	upstreamModel := info.UpstreamModelName
	if upstreamModel == "" {
		upstreamModel = info.OriginModelName
	}
	resolutionTier := imageResolutionTier(*request)
	channelModels := selectedChannelModels(c, info)
	if selected, ok, err := selectChannelBoundImageTierModel(upstreamModel, resolutionTier, channelModels, info); err != nil {
		return err
	} else if ok {
		upstreamModel = selected
	}
	if err := validateOfficialImageSkuChannel(upstreamModel, channelModels, info); err != nil {
		return err
	}
	mappedModel, mapped, err := helper.MapModelName(c.GetString("model_mapping"), upstreamModel)
	if err != nil {
		return err
	}
	if shouldKeepApimartBaseGptImage2Model(upstreamModel, mappedModel, resolutionTier, channelModels, info) {
		mappedModel = upstreamModel
		mapped = upstreamModel != info.OriginModelName
	}
	if shouldKeepSelectedImageTierModel(upstreamModel, mappedModel, resolutionTier) {
		mappedModel = upstreamModel
		mapped = upstreamModel != info.OriginModelName
	}
	info.UpstreamModelName = mappedModel
	info.IsModelMapped = mapped || mappedModel != info.OriginModelName
	request.SetModelName(mappedModel)
	return nil
}

func selectedChannelModels(c *gin.Context, info *relaycommon.RelayInfo) []string {
	if c != nil {
		if models, ok := common.GetContextKeyType[[]string](c, constant.ContextKeyChannelModels); ok {
			return models
		}
	}
	if info == nil || info.ChannelId == 0 {
		return nil
	}
	channel, err := model.CacheGetChannel(info.ChannelId)
	if err != nil || channel == nil {
		return nil
	}
	return channel.GetModels()
}

func selectChannelBoundImageTierModel(currentModel string, resolutionTier string, channelModels []string, info *relaycommon.RelayInfo) (string, bool, error) {
	currentModel = strings.TrimSpace(currentModel)
	if currentModel == "" || resolutionTier == "1K" {
		return "", false, nil
	}
	if isGptImage2OfficialModel(currentModel) {
		return "", false, nil
	}
	if !isGptImage2RoutableModel(currentModel) {
		return "", false, nil
	}
	if shouldUseApimartBaseGptImage2ForHighResolution(currentModel, resolutionTier, channelModels, info) {
		return "", false, nil
	}
	requiredRanks := requiredGptImage2TierRanks(resolutionTier)
	if currentRank := gptImage2TierRank(currentModel); currentRank > 1 {
		requiredRanks = []int{currentRank}
	}
	for _, requiredRank := range requiredRanks {
		for _, candidate := range channelModels {
			candidate = strings.TrimSpace(candidate)
			if candidate == "" || isGptImage2OfficialModel(candidate) || !isGptImage2RoutableModel(candidate) {
				continue
			}
			if gptImage2TierRank(candidate) != requiredRank {
				continue
			}
			return candidate, candidate != currentModel, nil
		}
	}
	return "", false, fmt.Errorf("gpt-image-2 %s request requires a real tier model on the selected channel; channel models=%s", resolutionTier, strings.Join(channelModels, ","))
}

func shouldUseApimartBaseGptImage2ForHighResolution(currentModel string, resolutionTier string, channelModels []string, info *relaycommon.RelayInfo) bool {
	if resolutionTier == "1K" || !isGptImage2BaseModel(currentModel) {
		return false
	}
	if !isApimartChannel(info) {
		return false
	}
	return channelHasModel(channelModels, gptImage2CanonicalModel)
}

func shouldKeepApimartBaseGptImage2Model(selectedModel string, mappedModel string, resolutionTier string, channelModels []string, info *relaycommon.RelayInfo) bool {
	if !shouldUseApimartBaseGptImage2ForHighResolution(selectedModel, resolutionTier, channelModels, info) {
		return false
	}
	return strings.TrimSpace(mappedModel) != strings.TrimSpace(selectedModel)
}

func shouldKeepSelectedImageTierModel(selectedModel string, mappedModel string, resolutionTier string) bool {
	if resolutionTier == "1K" {
		return false
	}
	if isGptImage2OfficialModel(selectedModel) {
		return false
	}
	if !isGptImage2RoutableModel(selectedModel) {
		return false
	}
	return gptImage2TierRank(selectedModel) > 1 && strings.TrimSpace(mappedModel) == gptImage2CanonicalModel
}

func isApimartChannel(info *relaycommon.RelayInfo) bool {
	if info == nil || info.ChannelMeta == nil {
		return false
	}
	if info.ChannelType == constant.ChannelTypeApimart {
		return true
	}
	return strings.Contains(strings.ToLower(strings.TrimSpace(info.ChannelBaseUrl)), "api.apimart.ai")
}

func channelHasModel(channelModels []string, modelName string) bool {
	modelName = strings.TrimSpace(modelName)
	for _, channelModel := range channelModels {
		if strings.TrimSpace(channelModel) == modelName {
			return true
		}
	}
	return false
}

func validateOfficialImageSkuChannel(selectedModel string, channelModels []string, info *relaycommon.RelayInfo) error {
	if !isOfficialImageSku(selectedModel) {
		return nil
	}
	if info == nil || info.ChannelMeta == nil || info.ChannelType != constant.ChannelTypeApimart {
		return fmt.Errorf("%s must route through an APIMart official SKU channel", selectedModel)
	}
	for _, channelModel := range channelModels {
		if strings.TrimSpace(channelModel) == selectedModel {
			return nil
		}
	}
	return fmt.Errorf("%s is not bound to the selected channel", selectedModel)
}

func isGptImage2RoutableModel(modelName string) bool {
	modelName = strings.TrimSpace(modelName)
	if modelName == "" {
		return false
	}
	return model.CanonicalModelKey(modelName) == gptImage2CanonicalModel && !isGptImage2OfficialModel(modelName)
}

func isGptImage2BaseModel(modelName string) bool {
	return strings.TrimSpace(modelName) == gptImage2CanonicalModel
}

func isGptImage2OfficialModel(modelName string) bool {
	return strings.TrimSpace(modelName) == gptImage2OfficialModel
}

func isOfficialImageSku(modelName string) bool {
	switch strings.TrimSpace(modelName) {
	case gptImage2OfficialModel, "gemini-3-pro-image-preview-official":
		return true
	default:
		return false
	}
}

func requiredGptImage2TierRanks(resolutionTier string) []int {
	switch resolutionTier {
	case "2K", "4K":
		return []int{3, 2, 4}
	default:
		return nil
	}
}

func gptImage2TierRank(modelName string) int {
	modelName = strings.ToLower(strings.TrimSpace(modelName))
	switch {
	case isGptImage2OfficialModel(modelName):
		return 4
	case strings.Contains(modelName, "-pro"):
		return 3
	case strings.Contains(modelName, "-vip"):
		return 2
	default:
		return 1
	}
}

func imageResolutionTier(request dto.ImageRequest) string {
	for _, key := range []string{"resolution", "imageSize", "image_size"} {
		if value := stringExtraValue(request.Extra[key]); value != "" {
			return normalizeImageResolutionTier(value)
		}
	}
	if raw := request.Extra["metadata"]; len(raw) > 0 {
		var metadata map[string]json.RawMessage
		if err := common.Unmarshal(raw, &metadata); err == nil {
			for _, key := range []string{"resolution", "imageSize", "image_size"} {
				if value := stringExtraValue(metadata[key]); value != "" {
					return normalizeImageResolutionTier(value)
				}
			}
		}
	}
	if tier := imageResolutionTierFromPixelSize(request.Size); tier != "" {
		return tier
	}
	switch strings.ToLower(strings.TrimSpace(request.Quality)) {
	case "high", "hd":
		return "2K"
	default:
		return "1K"
	}
}

func stringExtraValue(raw json.RawMessage) string {
	if len(raw) == 0 {
		return ""
	}
	var value string
	if err := common.Unmarshal(raw, &value); err != nil {
		return ""
	}
	return strings.TrimSpace(value)
}

func normalizeImageResolutionTier(value string) string {
	switch strings.ToUpper(strings.TrimSpace(value)) {
	case "2K":
		return "2K"
	case "4K":
		return "4K"
	default:
		return "1K"
	}
}

func imageResolutionTierFromPixelSize(size string) string {
	normalized := strings.ToLower(strings.TrimSpace(size))
	switch {
	case strings.Contains(normalized, "4096") ||
		strings.Contains(normalized, "3840x2160") ||
		strings.Contains(normalized, "2160x3840"):
		return "4K"
	case strings.Contains(normalized, "2048") ||
		strings.Contains(normalized, "3072"):
		return "2K"
	default:
		return ""
	}
}
