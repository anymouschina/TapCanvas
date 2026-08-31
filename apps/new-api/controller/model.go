package controller

import (
	"fmt"
	"net/http"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/dto"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/relay"
	"github.com/QuantumNous/new-api/relay/channel/ai360"
	"github.com/QuantumNous/new-api/relay/channel/lingyiwanwu"
	"github.com/QuantumNous/new-api/relay/channel/minimax"
	"github.com/QuantumNous/new-api/relay/channel/moonshot"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	"github.com/QuantumNous/new-api/service"
	"github.com/QuantumNous/new-api/setting/operation_setting"
	"github.com/QuantumNous/new-api/setting/ratio_setting"
	"github.com/QuantumNous/new-api/types"
	"github.com/gin-gonic/gin"
	"github.com/samber/lo"
)

// https://platform.openai.com/docs/api-reference/models/list

var openAIModels []dto.OpenAIModels
var openAIModelsMap map[string]dto.OpenAIModels
var channelId2Models map[int][]string

func appendCanonicalModels(target []string, rawModels []string) []string {
	seen := make(map[string]struct{}, len(target)+len(rawModels))
	for _, existing := range target {
		seen[existing] = struct{}{}
	}
	for _, modelName := range rawModels {
		canonicalModelName := model.CanonicalModelKey(modelName)
		if canonicalModelName == "" {
			continue
		}
		if _, exists := seen[canonicalModelName]; exists {
			continue
		}
		seen[canonicalModelName] = struct{}{}
		target = append(target, canonicalModelName)
	}
	return target
}

func getProtocolModels(definition constant.ProtocolDefinition) ([]string, string, error) {
	channelType := 0
	if len(definition.RecommendedChannelTypes) > 0 {
		channelType = definition.RecommendedChannelTypes[0]
	}
	info := &relaycommon.RelayInfo{ChannelMeta: &relaycommon.ChannelMeta{
		ChannelType:       channelType,
		ProtocolID:        definition.ID,
		ProtocolTransport: definition.Transport,
		ApiType:           definition.APIType,
	}}
	switch definition.Transport {
	case constant.ProtocolTransportRelay:
		adaptor := relay.GetAdaptor(definition.APIType)
		if adaptor == nil {
			return nil, "", fmt.Errorf(
				"协议 %q 的 relay adaptor 未注册（API type %d）",
				definition.ID,
				definition.APIType,
			)
		}
		adaptor.Init(info)
		return adaptor.GetModelList(), adaptor.GetChannelName(), nil
	case constant.ProtocolTransportTask:
		adaptor := relay.GetTaskAdaptor(definition.TaskPlatform)
		if adaptor == nil {
			return nil, "", fmt.Errorf(
				"协议 %q 的 task adaptor 未注册（platform %q）",
				definition.ID,
				definition.TaskPlatform,
			)
		}
		adaptor.Init(info)
		return adaptor.GetModelList(), adaptor.GetChannelName(), nil
	case constant.ProtocolTransportNative:
		if definition.ID != constant.ProtocolNativeMJ {
			return nil, "", fmt.Errorf("协议 %q 的 native handler 未注册", definition.ID)
		}
		modelNames := make([]string, 0, len(constant.MidjourneyModel2Action))
		for modelName := range constant.MidjourneyModel2Action {
			modelNames = append(modelNames, modelName)
		}
		return modelNames, "midjourney", nil
	default:
		return nil, "", fmt.Errorf(
			"协议 %q 使用未知 transport %q",
			definition.ID,
			definition.Transport,
		)
	}
}

func init() {
	// https://platform.openai.com/docs/models/model-endpoint-compatibility
	channelId2Models = make(map[int][]string)
	for _, protocolDefinition := range constant.ListProtocolDefinitions() {
		modelNames, channelName, err := getProtocolModels(protocolDefinition)
		if err != nil {
			panic(err)
		}
		for _, modelName := range modelNames {
			canonicalModelName := model.CanonicalModelKey(modelName)
			if canonicalModelName == "" {
				continue
			}
			openAIModels = append(openAIModels, dto.OpenAIModels{
				Id:      canonicalModelName,
				Object:  "model",
				Created: 1626777600,
				OwnedBy: channelName,
			})
		}
		for _, channelType := range protocolDefinition.RecommendedChannelTypes {
			channelId2Models[channelType] = appendCanonicalModels(channelId2Models[channelType], modelNames)
		}
	}
	for _, modelName := range ai360.ModelList {
		canonicalModelName := model.CanonicalModelKey(modelName)
		if canonicalModelName == "" {
			continue
		}
		openAIModels = append(openAIModels, dto.OpenAIModels{
			Id:      canonicalModelName,
			Object:  "model",
			Created: 1626777600,
			OwnedBy: ai360.ChannelName,
		})
	}
	for _, modelName := range moonshot.ModelList {
		canonicalModelName := model.CanonicalModelKey(modelName)
		if canonicalModelName == "" {
			continue
		}
		openAIModels = append(openAIModels, dto.OpenAIModels{
			Id:      canonicalModelName,
			Object:  "model",
			Created: 1626777600,
			OwnedBy: moonshot.ChannelName,
		})
	}
	for _, modelName := range lingyiwanwu.ModelList {
		canonicalModelName := model.CanonicalModelKey(modelName)
		if canonicalModelName == "" {
			continue
		}
		openAIModels = append(openAIModels, dto.OpenAIModels{
			Id:      canonicalModelName,
			Object:  "model",
			Created: 1626777600,
			OwnedBy: lingyiwanwu.ChannelName,
		})
	}
	for _, modelName := range minimax.ModelList {
		canonicalModelName := model.CanonicalModelKey(modelName)
		if canonicalModelName == "" {
			continue
		}
		openAIModels = append(openAIModels, dto.OpenAIModels{
			Id:      canonicalModelName,
			Object:  "model",
			Created: 1626777600,
			OwnedBy: minimax.ChannelName,
		})
	}
	openAIModelsMap = make(map[string]dto.OpenAIModels)
	for _, aiModel := range openAIModels {
		openAIModelsMap[aiModel.Id] = aiModel
	}
	openAIModels = lo.UniqBy(openAIModels, func(m dto.OpenAIModels) string {
		return m.Id
	})
}

func ListModels(c *gin.Context, modelType int) {
	userOpenAiModels := make([]dto.OpenAIModels, 0)

	acceptUnsetRatioModel := operation_setting.SelfUseModeEnabled
	if !acceptUnsetRatioModel {
		userId := c.GetInt("id")
		if userId > 0 {
			userSettings, _ := model.GetUserSetting(userId, false)
			if userSettings.AcceptUnsetRatioModel {
				acceptUnsetRatioModel = true
			}
		}
	}

	modelLimitEnable := common.GetContextKeyBool(c, constant.ContextKeyTokenModelLimitEnabled)
	if modelLimitEnable {
		s, ok := common.GetContextKey(c, constant.ContextKeyTokenModelLimit)
		var tokenModelLimit map[string]bool
		if ok {
			tokenModelLimit = s.(map[string]bool)
		} else {
			tokenModelLimit = map[string]bool{}
		}
		for allowModel, _ := range tokenModelLimit {
			if !acceptUnsetRatioModel {
				_, _, exist := ratio_setting.GetModelRatioOrPrice(allowModel)
				if !exist {
					continue
				}
			}
			if oaiModel, ok := openAIModelsMap[allowModel]; ok {
				oaiModel.SupportedEndpointTypes = model.GetModelSupportEndpointTypes(allowModel)
				userOpenAiModels = append(userOpenAiModels, oaiModel)
			} else {
				userOpenAiModels = append(userOpenAiModels, dto.OpenAIModels{
					Id:                     allowModel,
					Object:                 "model",
					Created:                1626777600,
					OwnedBy:                "custom",
					SupportedEndpointTypes: model.GetModelSupportEndpointTypes(allowModel),
				})
			}
		}
	} else {
		userId := c.GetInt("id")
		userGroup, err := model.GetUserGroup(userId, false)
		if err != nil {
			c.JSON(http.StatusOK, gin.H{
				"success": false,
				"message": "get user group failed",
			})
			return
		}
		group := userGroup
		tokenGroup := common.GetContextKeyString(c, constant.ContextKeyTokenGroup)
		if tokenGroup != "" {
			group = tokenGroup
		}
		var models []string
		if tokenGroup == "auto" {
			for _, autoGroup := range service.GetUserAutoGroup(userGroup) {
				groupModels := model.GetGroupEnabledModels(autoGroup)
				for _, g := range groupModels {
					if !common.StringsContains(models, g) {
						models = append(models, g)
					}
				}
			}
		} else {
			models = model.GetGroupEnabledModels(group)
		}
		for _, modelName := range models {
			if !acceptUnsetRatioModel {
				_, _, exist := ratio_setting.GetModelRatioOrPrice(modelName)
				if !exist {
					continue
				}
			}
			if oaiModel, ok := openAIModelsMap[modelName]; ok {
				oaiModel.SupportedEndpointTypes = model.GetModelSupportEndpointTypes(modelName)
				userOpenAiModels = append(userOpenAiModels, oaiModel)
			} else {
				userOpenAiModels = append(userOpenAiModels, dto.OpenAIModels{
					Id:                     modelName,
					Object:                 "model",
					Created:                1626777600,
					OwnedBy:                "custom",
					SupportedEndpointTypes: model.GetModelSupportEndpointTypes(modelName),
				})
			}
		}
	}

	switch modelType {
	case constant.ChannelTypeAnthropic:
		useranthropicModels := make([]dto.AnthropicModel, len(userOpenAiModels))
		for i, model := range userOpenAiModels {
			useranthropicModels[i] = dto.AnthropicModel{
				ID:          model.Id,
				CreatedAt:   time.Unix(int64(model.Created), 0).UTC().Format(time.RFC3339),
				DisplayName: model.Id,
				Type:        "model",
			}
		}
		c.JSON(200, gin.H{
			"data":     useranthropicModels,
			"first_id": useranthropicModels[0].ID,
			"has_more": false,
			"last_id":  useranthropicModels[len(useranthropicModels)-1].ID,
		})
	case constant.ChannelTypeGemini:
		userGeminiModels := make([]dto.GeminiModel, len(userOpenAiModels))
		for i, model := range userOpenAiModels {
			userGeminiModels[i] = dto.GeminiModel{
				Name:        model.Id,
				DisplayName: model.Id,
			}
		}
		c.JSON(200, gin.H{
			"models":        userGeminiModels,
			"nextPageToken": nil,
		})
	default:
		c.JSON(200, gin.H{
			"success": true,
			"data":    userOpenAiModels,
			"object":  "list",
		})
	}
}

func ChannelListModels(c *gin.Context) {
	c.JSON(200, gin.H{
		"success": true,
		"data":    openAIModels,
	})
}

func DashboardListModels(c *gin.Context) {
	c.JSON(200, gin.H{
		"success": true,
		"data":    channelId2Models,
	})
}

func EnabledListModels(c *gin.Context) {
	c.JSON(200, gin.H{
		"success": true,
		"data":    model.GetEnabledModels(),
	})
}

func RetrieveModel(c *gin.Context, modelType int) {
	modelId := model.CanonicalModelKey(c.Param("model"))
	if aiModel, ok := openAIModelsMap[modelId]; ok {
		switch modelType {
		case constant.ChannelTypeAnthropic:
			c.JSON(200, dto.AnthropicModel{
				ID:          aiModel.Id,
				CreatedAt:   time.Unix(int64(aiModel.Created), 0).UTC().Format(time.RFC3339),
				DisplayName: aiModel.Id,
				Type:        "model",
			})
		default:
			c.JSON(200, aiModel)
		}
	} else {
		openAIError := types.OpenAIError{
			Message: fmt.Sprintf("The model '%s' does not exist", modelId),
			Type:    "invalid_request_error",
			Param:   "model",
			Code:    "model_not_found",
		}
		c.JSON(200, gin.H{
			"error": openAIError,
		})
	}
}
