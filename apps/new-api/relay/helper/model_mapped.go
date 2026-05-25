package helper

import (
	"encoding/json"
	"errors"
	"fmt"
	"strings"

	"github.com/QuantumNous/new-api/dto"
	"github.com/QuantumNous/new-api/relay/common"
	relayconstant "github.com/QuantumNous/new-api/relay/constant"
	"github.com/QuantumNous/new-api/setting/ratio_setting"
	"github.com/gin-gonic/gin"
)

func ModelMappedHelper(c *gin.Context, info *common.RelayInfo, request dto.Request) error {
	if info.ChannelMeta == nil {
		info.ChannelMeta = &common.ChannelMeta{}
	}

	isResponsesCompact := info.RelayMode == relayconstant.RelayModeResponsesCompact
	originModelName := info.OriginModelName
	mappingModelName := originModelName
	if isResponsesCompact && strings.HasSuffix(originModelName, ratio_setting.CompactModelSuffix) {
		mappingModelName = strings.TrimSuffix(originModelName, ratio_setting.CompactModelSuffix)
	}

	// map model name
	modelMapping := c.GetString("model_mapping")
	mappedModelName, mapped, err := MapModelName(modelMapping, mappingModelName)
	if err != nil {
		return err
	}
	if mapped {
		info.IsModelMapped = true
		info.UpstreamModelName = mappedModelName
	}

	if isResponsesCompact {
		finalUpstreamModelName := mappingModelName
		if info.IsModelMapped && info.UpstreamModelName != "" {
			finalUpstreamModelName = info.UpstreamModelName
		}
		info.UpstreamModelName = finalUpstreamModelName
		info.OriginModelName = ratio_setting.WithCompactModelSuffix(finalUpstreamModelName)
	}
	if request != nil {
		request.SetModelName(info.UpstreamModelName)
	}
	return nil
}

func MapModelName(modelMapping string, modelName string) (string, bool, error) {
	modelMapping = strings.TrimSpace(modelMapping)
	if modelMapping == "" || modelMapping == "{}" {
		return modelName, false, nil
	}
	modelMap := make(map[string]string)
	err := json.Unmarshal([]byte(modelMapping), &modelMap)
	if err != nil {
		return "", false, fmt.Errorf("unmarshal_model_mapping_failed")
	}

	currentModel := modelName
	visitedModels := map[string]bool{
		currentModel: true,
	}
	for {
		mappedModel, exists := modelMap[currentModel]
		if !exists || mappedModel == "" {
			break
		}
		if visitedModels[mappedModel] {
			if mappedModel == currentModel {
				return currentModel, currentModel != modelName, nil
			}
			return "", false, errors.New("model_mapping_contains_cycle")
		}
		visitedModels[mappedModel] = true
		currentModel = mappedModel
	}
	return currentModel, currentModel != modelName, nil
}
