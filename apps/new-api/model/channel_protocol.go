package model

import (
	"fmt"
	"strings"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/dto"
)

const (
	ProtocolBindingSourceDefault = "channel_default"
	ProtocolBindingSourceModel   = "model_override"
)

// ResolvedProtocolBinding is the validated runtime result of combining a
// channel's explicit default protocol with an optional model override.
type ResolvedProtocolBinding struct {
	Binding        dto.ProtocolBinding
	Protocol       constant.ProtocolDefinition
	ChannelSetting dto.ChannelSettings
	Source         string
	ModelKey       string
}

func cloneProtocolBinding(binding dto.ProtocolBinding) dto.ProtocolBinding {
	cloned := dto.ProtocolBinding{
		Protocol: strings.TrimSpace(binding.Protocol),
	}
	if len(binding.Options) > 0 {
		cloned.Options = make(map[string]string, len(binding.Options))
		for key, value := range binding.Options {
			cloned.Options[strings.TrimSpace(key)] = strings.TrimSpace(value)
		}
	}
	return cloned
}

func validateProtocolBinding(binding dto.ProtocolBinding, path string) (dto.ProtocolBinding, constant.ProtocolDefinition, error) {
	normalizedOptionKeys := make(map[string]struct{}, len(binding.Options))
	for key := range binding.Options {
		normalizedKey := strings.TrimSpace(key)
		if normalizedKey == "" {
			return dto.ProtocolBinding{}, constant.ProtocolDefinition{}, fmt.Errorf("%s.options 不能包含空键", path)
		}
		if _, exists := normalizedOptionKeys[normalizedKey]; exists {
			return dto.ProtocolBinding{}, constant.ProtocolDefinition{}, fmt.Errorf("%s.options 包含重复键 %q", path, normalizedKey)
		}
		normalizedOptionKeys[normalizedKey] = struct{}{}
	}
	normalized := cloneProtocolBinding(binding)
	if normalized.Protocol == "" {
		return dto.ProtocolBinding{}, constant.ProtocolDefinition{}, fmt.Errorf("%s.protocol 不能为空", path)
	}
	definition, ok := constant.GetProtocolDefinition(normalized.Protocol)
	if !ok {
		return dto.ProtocolBinding{}, constant.ProtocolDefinition{}, fmt.Errorf("%s.protocol %q 未注册", path, normalized.Protocol)
	}
	allowedOptions := make(map[string]constant.ProtocolOptionDefinition, len(definition.Options))
	for _, option := range definition.Options {
		allowedOptions[option.Key] = option
	}
	for key, value := range normalized.Options {
		if _, exists := allowedOptions[key]; !exists {
			return dto.ProtocolBinding{}, constant.ProtocolDefinition{}, fmt.Errorf(
				"%s.options[%q] 不属于协议 %q",
				path,
				key,
				normalized.Protocol,
			)
		}
		if value == "" {
			return dto.ProtocolBinding{}, constant.ProtocolDefinition{}, fmt.Errorf("%s.options[%q] 不能为空", path, key)
		}
	}
	for _, option := range definition.Options {
		if option.Required && normalized.Options[option.Key] == "" {
			return dto.ProtocolBinding{}, constant.ProtocolDefinition{}, fmt.Errorf(
				"%s.options[%q] 是协议 %q 的必填参数",
				path,
				option.Key,
				normalized.Protocol,
			)
		}
	}
	return normalized, definition, nil
}

func protocolModelLookupKeys(modelName string) []string {
	seen := make(map[string]struct{})
	keys := make([]string, 0)
	appendKey := func(value string) {
		value = strings.TrimSpace(value)
		if value == "" {
			return
		}
		if _, exists := seen[value]; exists {
			return
		}
		seen[value] = struct{}{}
		keys = append(keys, value)
	}

	appendKey(modelName)
	appendKey(CanonicalModelKey(modelName))
	for _, candidate := range RoutingModelCandidates(modelName) {
		appendKey(candidate)
	}
	return keys
}

// ResolveProtocolBinding resolves a model override first, followed by the
// channel's explicitly configured default. Missing configuration is an error;
// there is deliberately no inference from Channel.Type.
func ResolveProtocolBinding(settings dto.ChannelSettings, modelName string) (ResolvedProtocolBinding, error) {
	for _, key := range protocolModelLookupKeys(modelName) {
		binding, exists := settings.ModelProtocols[key]
		if !exists {
			continue
		}
		normalized, definition, err := validateProtocolBinding(binding, fmt.Sprintf("model_protocols[%q]", key))
		if err != nil {
			return ResolvedProtocolBinding{}, err
		}
		return ResolvedProtocolBinding{
			Binding:        normalized,
			Protocol:       definition,
			ChannelSetting: settings,
			Source:         ProtocolBindingSourceModel,
			ModelKey:       key,
		}, nil
	}

	if settings.DefaultProtocol == nil {
		return ResolvedProtocolBinding{}, fmt.Errorf("模型 %q 未配置协议，且渠道没有显式默认协议", strings.TrimSpace(modelName))
	}
	normalized, definition, err := validateProtocolBinding(*settings.DefaultProtocol, "default_protocol")
	if err != nil {
		return ResolvedProtocolBinding{}, err
	}
	return ResolvedProtocolBinding{
		Binding:        normalized,
		Protocol:       definition,
		ChannelSetting: settings,
		Source:         ProtocolBindingSourceDefault,
	}, nil
}

func parseChannelSettings(raw *string) (dto.ChannelSettings, error) {
	settings := dto.ChannelSettings{}
	if raw == nil || strings.TrimSpace(*raw) == "" {
		return settings, nil
	}
	if err := common.Unmarshal([]byte(*raw), &settings); err != nil {
		return dto.ChannelSettings{}, err
	}
	return settings, nil
}

// ResolveProtocol resolves and validates the protocol used by this channel for
// a model without mutating persisted channel settings.
func (channel *Channel) ResolveProtocol(modelName string) (ResolvedProtocolBinding, error) {
	if channel == nil {
		return ResolvedProtocolBinding{}, fmt.Errorf("channel is nil")
	}
	settings, err := parseChannelSettings(channel.Setting)
	if err != nil {
		return ResolvedProtocolBinding{}, fmt.Errorf("渠道 %d 的 setting 不是合法 JSON: %w", channel.Id, err)
	}
	resolved, err := ResolveProtocolBinding(settings, modelName)
	if err != nil {
		return ResolvedProtocolBinding{}, fmt.Errorf("渠道 %d(%s): %w", channel.Id, channel.Name, err)
	}
	return resolved, nil
}

func channelModelKeys(channel *Channel) map[string]struct{} {
	keys := make(map[string]struct{})
	if channel == nil {
		return keys
	}
	for _, modelName := range channel.GetModels() {
		for _, key := range protocolModelLookupKeys(modelName) {
			keys[key] = struct{}{}
		}
	}
	return keys
}

// ValidateProtocolSettings enforces an explicit protocol for every configured
// model and rejects stale overrides that no longer belong to the channel.
func (channel *Channel) ValidateProtocolSettings() error {
	settings, err := parseChannelSettings(channel.Setting)
	if err != nil {
		return err
	}

	if settings.DefaultProtocol != nil {
		if _, _, err := validateProtocolBinding(*settings.DefaultProtocol, "default_protocol"); err != nil {
			return err
		}
	}

	channelKeys := channelModelKeys(channel)
	for modelKey, binding := range settings.ModelProtocols {
		trimmedModelKey := strings.TrimSpace(modelKey)
		if trimmedModelKey == "" {
			return fmt.Errorf("model_protocols 不能包含空模型名")
		}
		if _, exists := channelKeys[trimmedModelKey]; !exists {
			return fmt.Errorf("model_protocols[%q] 不属于当前渠道模型列表", modelKey)
		}
		if _, _, err := validateProtocolBinding(binding, fmt.Sprintf("model_protocols[%q]", modelKey)); err != nil {
			return err
		}
	}

	for _, modelName := range channel.GetModels() {
		if strings.TrimSpace(modelName) == "" {
			continue
		}
		if _, err := ResolveProtocolBinding(settings, modelName); err != nil {
			return err
		}
	}
	return nil
}

// ValidateProtocolSettingsForModel validates the complete protocol JSON shape
// and the requested model without requiring unrelated legacy models to be
// migrated in the same transaction. Unconfigured models still fail explicitly
// when routed; this method only enables progressive, model-by-model cutover.
func (channel *Channel) ValidateProtocolSettingsForModel(modelName string) error {
	settings, err := parseChannelSettings(channel.Setting)
	if err != nil {
		return err
	}
	if settings.DefaultProtocol != nil {
		if _, _, err := validateProtocolBinding(*settings.DefaultProtocol, "default_protocol"); err != nil {
			return err
		}
	}
	for modelKey, binding := range settings.ModelProtocols {
		if strings.TrimSpace(modelKey) == "" {
			return fmt.Errorf("model_protocols 不能包含空模型名")
		}
		if _, _, err := validateProtocolBinding(binding, fmt.Sprintf("model_protocols[%q]", modelKey)); err != nil {
			return err
		}
	}
	_, err = ResolveProtocolBinding(settings, modelName)
	return err
}

// ChannelSupportsProtocolModel reports whether the channel's declared model
// set contains the model itself or one of its canonical routing aliases.
func ChannelSupportsProtocolModel(channel *Channel, modelName string) bool {
	if channel == nil {
		return false
	}
	channelKeys := channelModelKeys(channel)
	for _, key := range protocolModelLookupKeys(modelName) {
		if _, exists := channelKeys[key]; exists {
			return true
		}
	}
	return false
}
