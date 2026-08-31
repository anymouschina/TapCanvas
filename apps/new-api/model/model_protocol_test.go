package model

import (
	"encoding/json"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/dto"
)

const modelProtocolTestName = "protocol-control-test-model"

func prepareModelProtocolTestData(t *testing.T) (Model, Channel) {
	t.Helper()
	if err := DB.AutoMigrate(&Model{}, &Channel{}, &Ability{}); err != nil {
		t.Fatalf("failed to migrate protocol test tables: %v", err)
	}

	settings := dto.ChannelSettings{
		Proxy: "http://proxy.internal",
		DefaultProtocol: &dto.ProtocolBinding{
			Protocol: constant.ProtocolOpenAI,
		},
	}
	rawSettings, err := common.Marshal(settings)
	if err != nil {
		t.Fatalf("failed to marshal seed settings: %v", err)
	}
	rawSettingsText := string(rawSettings)
	modelMeta := Model{
		ModelName: modelProtocolTestName,
		NameRule:  NameRuleExact,
		Status:    1,
	}
	if err := DB.Create(&modelMeta).Error; err != nil {
		t.Fatalf("failed to create model: %v", err)
	}
	channel := Channel{
		Type:    constant.ChannelTypeOpenAI,
		Key:     "test-key",
		Name:    "protocol-control-channel",
		Models:  modelProtocolTestName,
		Group:   "default",
		Status:  common.ChannelStatusEnabled,
		Setting: &rawSettingsText,
	}
	if err := DB.Create(&channel).Error; err != nil {
		t.Fatalf("failed to create channel: %v", err)
	}
	priority := int64(0)
	if err := DB.Create(&Ability{
		Group:     "default",
		Model:     modelProtocolTestName,
		ChannelId: channel.Id,
		Enabled:   true,
		Priority:  &priority,
	}).Error; err != nil {
		t.Fatalf("failed to create ability: %v", err)
	}

	t.Cleanup(func() {
		DB.Where("channel_id = ?", channel.Id).Delete(&Ability{})
		DB.Delete(&Channel{}, channel.Id)
		DB.Unscoped().Delete(&Model{}, modelMeta.Id)
	})
	return modelMeta, channel
}

func TestUpdateModelProtocolBindingsPersistsOverrideAndPreservesSettings(t *testing.T) {
	modelMeta, channel := prepareModelProtocolTestData(t)
	binding := dto.ProtocolBinding{
		Protocol: constant.ProtocolAnthropic,
		Options: map[string]string{
			"anthropic_version": "2023-06-01",
		},
	}

	_, err := UpdateModelProtocolBindings(modelMeta.Id, []ModelChannelProtocolUpdate{{
		ChannelID: channel.Id,
		Mode:      ModelProtocolBindingModeOverride,
		Binding:   &binding,
	}})
	if err != nil {
		t.Fatalf("update override failed: %v", err)
	}

	storedChannel, err := GetChannelById(channel.Id, true)
	if err != nil {
		t.Fatalf("reload channel failed: %v", err)
	}
	storedSettings, err := parseChannelSettings(storedChannel.Setting)
	if err != nil {
		t.Fatalf("parse stored settings failed: %v", err)
	}
	if storedSettings.Proxy != "http://proxy.internal" {
		t.Fatalf("unrelated proxy setting changed: %q", storedSettings.Proxy)
	}
	if storedSettings.DefaultProtocol == nil || storedSettings.DefaultProtocol.Protocol != constant.ProtocolOpenAI {
		t.Fatalf("default protocol changed unexpectedly: %#v", storedSettings.DefaultProtocol)
	}
	override, exists := storedSettings.ModelProtocols[modelProtocolTestName]
	if !exists {
		t.Fatal("model override was not persisted")
	}
	if override.Protocol != constant.ProtocolAnthropic {
		t.Fatalf("override protocol = %q", override.Protocol)
	}
	if override.Options["anthropic_version"] != "2023-06-01" {
		t.Fatalf("override options were not preserved: %#v", override.Options)
	}

	boundChannels, err := GetBoundChannelsByModelsMap([]string{modelProtocolTestName})
	if err != nil {
		t.Fatalf("load bound channels failed: %v", err)
	}
	if len(boundChannels[modelProtocolTestName]) != 1 {
		t.Fatalf("bound channel count = %d", len(boundChannels[modelProtocolTestName]))
	}
	bound := boundChannels[modelProtocolTestName][0]
	if bound.EffectiveProtocol != constant.ProtocolAnthropic {
		t.Fatalf("effective protocol = %q", bound.EffectiveProtocol)
	}
	if bound.ProtocolSource != ProtocolBindingSourceModel {
		t.Fatalf("protocol source = %q", bound.ProtocolSource)
	}
	if bound.ProtocolError != "" {
		t.Fatalf("unexpected protocol error: %s", bound.ProtocolError)
	}
}

func TestUpdateModelProtocolBindingsCanReturnToExplicitChannelDefault(t *testing.T) {
	modelMeta, channel := prepareModelProtocolTestData(t)
	override := dto.ProtocolBinding{Protocol: constant.ProtocolAnthropic}
	if _, err := UpdateModelProtocolBindings(modelMeta.Id, []ModelChannelProtocolUpdate{{
		ChannelID: channel.Id,
		Mode:      ModelProtocolBindingModeOverride,
		Binding:   &override,
	}}); err != nil {
		t.Fatalf("seed override failed: %v", err)
	}

	if _, err := UpdateModelProtocolBindings(modelMeta.Id, []ModelChannelProtocolUpdate{{
		ChannelID: channel.Id,
		Mode:      ModelProtocolBindingModeInherit,
	}}); err != nil {
		t.Fatalf("inherit update failed: %v", err)
	}

	storedChannel, err := GetChannelById(channel.Id, true)
	if err != nil {
		t.Fatalf("reload channel failed: %v", err)
	}
	resolved, err := storedChannel.ResolveProtocol(modelProtocolTestName)
	if err != nil {
		t.Fatalf("resolve inherited protocol failed: %v", err)
	}
	if resolved.Protocol.ID != constant.ProtocolOpenAI {
		t.Fatalf("inherited protocol = %q", resolved.Protocol.ID)
	}
	if resolved.Source != ProtocolBindingSourceDefault {
		t.Fatalf("inherited source = %q", resolved.Source)
	}
}

func TestBoundChannelProtocolEditorIncludesDisabledAbilities(t *testing.T) {
	_, channel := prepareModelProtocolTestData(t)
	if err := UpdateAbilityStatus(channel.Id, false); err != nil {
		t.Fatalf("disable channel abilities failed: %v", err)
	}

	boundChannels, err := GetBoundChannelsByModelsMap([]string{modelProtocolTestName})
	if err != nil {
		t.Fatalf("load bound channels failed: %v", err)
	}
	if len(boundChannels[modelProtocolTestName]) != 1 {
		t.Fatalf("bound channel count = %d", len(boundChannels[modelProtocolTestName]))
	}
	if boundChannels[modelProtocolTestName][0].AbilityEnabled {
		t.Fatal("disabled ability was reported as enabled")
	}
}

func TestUpdateModelProtocolBindingsRejectsUnboundChannel(t *testing.T) {
	modelMeta, channel := prepareModelProtocolTestData(t)
	if err := DB.Model(&Channel{}).Where("id = ?", channel.Id).Update("models", "different-model").Error; err != nil {
		t.Fatalf("failed to alter channel models: %v", err)
	}
	binding := dto.ProtocolBinding{Protocol: constant.ProtocolAnthropic}

	_, err := UpdateModelProtocolBindings(modelMeta.Id, []ModelChannelProtocolUpdate{{
		ChannelID: channel.Id,
		Mode:      ModelProtocolBindingModeOverride,
		Binding:   &binding,
	}})
	if err == nil {
		t.Fatal("expected unbound channel update to fail")
	}
}

func TestUpdateModelProtocolBindingsAllowsProgressiveLegacyCutover(t *testing.T) {
	if err := DB.AutoMigrate(&Model{}, &Channel{}, &Ability{}); err != nil {
		t.Fatalf("failed to migrate protocol test tables: %v", err)
	}
	meta := Model{
		ModelName: "progressive-protocol-model-a",
		NameRule:  NameRuleExact,
		Status:    1,
	}
	if err := DB.Create(&meta).Error; err != nil {
		t.Fatalf("failed to create model: %v", err)
	}
	channel := Channel{
		Type:   constant.ChannelTypeOpenAI,
		Key:    "test-key",
		Name:   "progressive-protocol-channel",
		Models: "progressive-protocol-model-a,progressive-protocol-model-b",
		Group:  "default",
		Status: common.ChannelStatusEnabled,
	}
	if err := DB.Create(&channel).Error; err != nil {
		t.Fatalf("failed to create channel: %v", err)
	}
	priority := int64(0)
	if err := DB.Create(&Ability{
		Group:     "default",
		Model:     meta.ModelName,
		ChannelId: channel.Id,
		Enabled:   true,
		Priority:  &priority,
	}).Error; err != nil {
		t.Fatalf("failed to create ability: %v", err)
	}
	t.Cleanup(func() {
		DB.Where("channel_id = ?", channel.Id).Delete(&Ability{})
		DB.Delete(&Channel{}, channel.Id)
		DB.Unscoped().Delete(&Model{}, meta.Id)
	})

	binding := dto.ProtocolBinding{Protocol: constant.ProtocolOpenAI}
	if _, err := UpdateModelProtocolBindings(meta.Id, []ModelChannelProtocolUpdate{{
		ChannelID: channel.Id,
		Mode:      ModelProtocolBindingModeOverride,
		Binding:   &binding,
	}}); err != nil {
		t.Fatalf("progressive model update failed: %v", err)
	}

	storedChannel, err := GetChannelById(channel.Id, true)
	if err != nil {
		t.Fatalf("reload channel failed: %v", err)
	}
	if _, err := storedChannel.ResolveProtocol(meta.ModelName); err != nil {
		t.Fatalf("configured model should resolve: %v", err)
	}
	if _, err := storedChannel.ResolveProtocol("progressive-protocol-model-b"); err == nil {
		t.Fatal("unconfigured sibling model must still fail explicitly")
	}
}

func TestUpdateModelProtocolBindingsPreservesUnknownChannelSettings(t *testing.T) {
	modelMeta, channel := prepareModelProtocolTestData(t)
	rawSetting := `{
		"proxy":"http://proxy.internal",
		"future_setting":{"enabled":true},
		"default_protocol":{"protocol":"openai","future_default":"keep"},
		"model_protocols":{
			"future-model":{"protocol":"gemini","future_binding":"keep"}
		}
	}`
	if err := DB.Model(&Channel{}).
		Where("id = ?", channel.Id).
		Update("setting", rawSetting).Error; err != nil {
		t.Fatalf("failed to seed unknown settings: %v", err)
	}

	binding := dto.ProtocolBinding{Protocol: constant.ProtocolAnthropic}
	if _, err := UpdateModelProtocolBindings(modelMeta.Id, []ModelChannelProtocolUpdate{{
		ChannelID: channel.Id,
		Mode:      ModelProtocolBindingModeOverride,
		Binding:   &binding,
	}}); err != nil {
		t.Fatalf("update override failed: %v", err)
	}

	storedChannel, err := GetChannelById(channel.Id, true)
	if err != nil {
		t.Fatalf("reload channel failed: %v", err)
	}
	var root map[string]json.RawMessage
	if err := common.Unmarshal([]byte(*storedChannel.Setting), &root); err != nil {
		t.Fatalf("parse stored root failed: %v", err)
	}
	var futureSetting struct {
		Enabled bool `json:"enabled"`
	}
	if err := common.Unmarshal(root["future_setting"], &futureSetting); err != nil {
		t.Fatalf("parse future_setting failed: %v", err)
	}
	if !futureSetting.Enabled {
		t.Fatal("unknown top-level setting was not preserved")
	}

	var defaultProtocol map[string]json.RawMessage
	if err := common.Unmarshal(root["default_protocol"], &defaultProtocol); err != nil {
		t.Fatalf("parse default_protocol failed: %v", err)
	}
	var futureDefault string
	if err := common.Unmarshal(defaultProtocol["future_default"], &futureDefault); err != nil {
		t.Fatalf("parse future default field failed: %v", err)
	}
	if futureDefault != "keep" {
		t.Fatalf("unknown default protocol field = %q", futureDefault)
	}

	var modelProtocols map[string]json.RawMessage
	if err := common.Unmarshal(root["model_protocols"], &modelProtocols); err != nil {
		t.Fatalf("parse model_protocols failed: %v", err)
	}
	var futureBinding map[string]json.RawMessage
	if err := common.Unmarshal(modelProtocols["future-model"], &futureBinding); err != nil {
		t.Fatalf("parse future model binding failed: %v", err)
	}
	var futureBindingValue string
	if err := common.Unmarshal(futureBinding["future_binding"], &futureBindingValue); err != nil {
		t.Fatalf("parse future binding field failed: %v", err)
	}
	if futureBindingValue != "keep" {
		t.Fatalf("unknown sibling binding field = %q", futureBindingValue)
	}
}
