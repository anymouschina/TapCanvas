package model

import (
	"encoding/json"
	"fmt"
	"strings"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/dto"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

type ModelProtocolBindingMode string

const (
	ModelProtocolBindingModeInherit  ModelProtocolBindingMode = "inherit"
	ModelProtocolBindingModeOverride ModelProtocolBindingMode = "override"
)

// ModelChannelProtocolUpdate describes one explicit model-channel protocol
// decision. "inherit" removes the model override and requires a valid channel
// default; "override" persists the supplied protocol binding.
type ModelChannelProtocolUpdate struct {
	ChannelID int
	Mode      ModelProtocolBindingMode
	Binding   *dto.ProtocolBinding
}

func validateModelChannelProtocolUpdate(update ModelChannelProtocolUpdate) error {
	if update.ChannelID <= 0 {
		return fmt.Errorf("channel_id 必须是正整数")
	}
	switch update.Mode {
	case ModelProtocolBindingModeInherit:
		if update.Binding != nil {
			return fmt.Errorf("渠道 %d 使用 inherit 时不能提交 binding", update.ChannelID)
		}
	case ModelProtocolBindingModeOverride:
		if update.Binding == nil {
			return fmt.Errorf("渠道 %d 使用 override 时必须提交 binding", update.ChannelID)
		}
		if _, _, err := validateProtocolBinding(*update.Binding, fmt.Sprintf("channels[%d].binding", update.ChannelID)); err != nil {
			return err
		}
	default:
		return fmt.Errorf("渠道 %d 的 mode 必须是 %q 或 %q", update.ChannelID, ModelProtocolBindingModeInherit, ModelProtocolBindingModeOverride)
	}
	return nil
}

func marshalModelProtocolUpdate(
	rawSetting *string,
	modelName string,
	update ModelChannelProtocolUpdate,
) (string, error) {
	root := make(map[string]json.RawMessage)
	if rawSetting != nil && strings.TrimSpace(*rawSetting) != "" {
		if err := common.Unmarshal([]byte(*rawSetting), &root); err != nil {
			return "", err
		}
		if root == nil {
			return "", fmt.Errorf("setting 必须是 JSON 对象")
		}
	}

	rawModelProtocols := make(map[string]json.RawMessage)
	if raw, exists := root["model_protocols"]; exists && string(raw) != "null" {
		if err := common.Unmarshal(raw, &rawModelProtocols); err != nil {
			return "", fmt.Errorf("model_protocols 不是合法 JSON 对象: %w", err)
		}
		if rawModelProtocols == nil {
			return "", fmt.Errorf("model_protocols 必须是 JSON 对象")
		}
	}

	for _, key := range protocolModelLookupKeys(modelName) {
		delete(rawModelProtocols, key)
	}
	if update.Mode == ModelProtocolBindingModeOverride {
		normalized, _, err := validateProtocolBinding(
			*update.Binding,
			fmt.Sprintf("channels[%d].binding", update.ChannelID),
		)
		if err != nil {
			return "", err
		}
		rawBinding, err := common.Marshal(normalized)
		if err != nil {
			return "", fmt.Errorf("序列化渠道 %d 的模型协议失败: %w", update.ChannelID, err)
		}
		rawModelProtocols[strings.TrimSpace(modelName)] = rawBinding
	}

	if len(rawModelProtocols) == 0 {
		delete(root, "model_protocols")
	} else {
		rawProtocols, err := common.Marshal(rawModelProtocols)
		if err != nil {
			return "", fmt.Errorf("序列化 model_protocols 失败: %w", err)
		}
		root["model_protocols"] = rawProtocols
	}

	rawRoot, err := common.Marshal(root)
	if err != nil {
		return "", fmt.Errorf("序列化渠道协议设置失败: %w", err)
	}
	return string(rawRoot), nil
}

func applyModelProtocolUpdate(channel *Channel, modelName string, update ModelChannelProtocolUpdate) error {
	rawSettings, err := marshalModelProtocolUpdate(channel.Setting, modelName, update)
	if err != nil {
		return fmt.Errorf("更新渠道 %d(%s) 协议设置失败: %w", channel.Id, channel.Name, err)
	}
	channel.Setting = &rawSettings
	if err := channel.ValidateProtocolSettingsForModel(modelName); err != nil {
		return fmt.Errorf("渠道 %d(%s) 协议设置无效: %w", channel.Id, channel.Name, err)
	}
	return nil
}

// UpdateModelProtocolBindings atomically updates protocol decisions for every
// requested bound channel while preserving all unrelated channel settings.
func UpdateModelProtocolBindings(modelID int, updates []ModelChannelProtocolUpdate) (*Model, error) {
	if modelID <= 0 {
		return nil, fmt.Errorf("模型 ID 必须是正整数")
	}
	if len(updates) == 0 {
		return nil, fmt.Errorf("协议绑定列表不能为空")
	}

	seenChannels := make(map[int]struct{}, len(updates))
	for _, update := range updates {
		if err := validateModelChannelProtocolUpdate(update); err != nil {
			return nil, err
		}
		if _, exists := seenChannels[update.ChannelID]; exists {
			return nil, fmt.Errorf("渠道 %d 重复提交", update.ChannelID)
		}
		seenChannels[update.ChannelID] = struct{}{}
	}

	var updatedModel Model
	err := DB.Transaction(func(tx *gorm.DB) error {
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).First(&updatedModel, modelID).Error; err != nil {
			return err
		}
		if updatedModel.NameRule != NameRuleExact {
			return fmt.Errorf("规则模型不能直接配置渠道协议，请编辑具体模型")
		}
		modelName := strings.TrimSpace(updatedModel.ModelName)
		if modelName == "" {
			return fmt.Errorf("模型名称不能为空")
		}

		for _, update := range updates {
			var channel Channel
			if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).First(&channel, update.ChannelID).Error; err != nil {
				return fmt.Errorf("读取渠道 %d 失败: %w", update.ChannelID, err)
			}
			if !ChannelSupportsProtocolModel(&channel, modelName) {
				return fmt.Errorf("渠道 %d(%s) 未声明模型 %q", channel.Id, channel.Name, modelName)
			}
			if err := applyModelProtocolUpdate(&channel, modelName, update); err != nil {
				return err
			}
			if err := tx.Model(&Channel{}).
				Where("id = ?", channel.Id).
				Update("setting", *channel.Setting).Error; err != nil {
				return fmt.Errorf("保存渠道 %d(%s) 协议设置失败: %w", channel.Id, channel.Name, err)
			}
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	return &updatedModel, nil
}
