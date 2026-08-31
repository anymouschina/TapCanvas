package model

import (
	"testing"

	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/dto"
)

func TestResolveProtocolBindingUsesModelOverrideBeforeDefault(t *testing.T) {
	settings := dto.ChannelSettings{
		DefaultProtocol: &dto.ProtocolBinding{Protocol: constant.ProtocolOpenAI},
		ModelProtocols: map[string]dto.ProtocolBinding{
			"claude-opus-4": {Protocol: constant.ProtocolAnthropic},
		},
	}

	resolved, err := ResolveProtocolBinding(settings, "claude-opus-4")
	if err != nil {
		t.Fatalf("ResolveProtocolBinding() error = %v", err)
	}
	if resolved.Protocol.ID != constant.ProtocolAnthropic {
		t.Fatalf("protocol = %q, want %q", resolved.Protocol.ID, constant.ProtocolAnthropic)
	}
	if resolved.Source != ProtocolBindingSourceModel {
		t.Fatalf("source = %q, want %q", resolved.Source, ProtocolBindingSourceModel)
	}
}

func TestResolveProtocolBindingReturnsValidatedChannelSetting(t *testing.T) {
	settings := dto.ChannelSettings{
		Proxy:           "socks5://127.0.0.1:1080",
		DefaultProtocol: &dto.ProtocolBinding{Protocol: constant.ProtocolOpenAI},
	}

	resolved, err := ResolveProtocolBinding(settings, "gpt-4.1")
	if err != nil {
		t.Fatalf("ResolveProtocolBinding() error = %v", err)
	}
	if resolved.ChannelSetting.Proxy != settings.Proxy {
		t.Fatalf(
			"resolved proxy = %q, want %q",
			resolved.ChannelSetting.Proxy,
			settings.Proxy,
		)
	}
}

func TestGetSettingDoesNotDeleteInvalidPersistedValue(t *testing.T) {
	rawSetting := "{invalid"
	channel := &Channel{
		Id:      101,
		Setting: &rawSetting,
	}

	_ = channel.GetSetting()

	if channel.Setting == nil || *channel.Setting != rawSetting {
		t.Fatal("GetSetting mutated an invalid persisted channel setting")
	}
}

func TestResolveProtocolBindingUsesCanonicalModelOverride(t *testing.T) {
	settings := dto.ChannelSettings{
		ModelProtocols: map[string]dto.ProtocolBinding{
			"gpt-image-2": {Protocol: constant.ProtocolAPIMart},
		},
	}

	resolved, err := ResolveProtocolBinding(settings, "gpt-image-2-apimart")
	if err != nil {
		t.Fatalf("ResolveProtocolBinding() error = %v", err)
	}
	if resolved.Protocol.ID != constant.ProtocolAPIMart {
		t.Fatalf("protocol = %q, want %q", resolved.Protocol.ID, constant.ProtocolAPIMart)
	}
	if resolved.ModelKey != "gpt-image-2" {
		t.Fatalf("model key = %q, want canonical key", resolved.ModelKey)
	}
}

func TestResolveProtocolBindingFailsWithoutExplicitConfiguration(t *testing.T) {
	_, err := ResolveProtocolBinding(dto.ChannelSettings{}, "gpt-4o")
	if err == nil {
		t.Fatal("expected missing protocol configuration to fail")
	}
}

func TestValidateProtocolSettingsRejectsStaleModelOverride(t *testing.T) {
	raw := `{
		"default_protocol":{"protocol":"openai"},
		"model_protocols":{"removed-model":{"protocol":"anthropic"}}
	}`
	channel := &Channel{
		Models:  "gpt-4o",
		Setting: &raw,
	}

	if err := channel.ValidateProtocolSettings(); err == nil {
		t.Fatal("expected stale protocol override to fail validation")
	}
}

func TestValidateProtocolSettingsAcceptsExplicitDefault(t *testing.T) {
	raw := `{"default_protocol":{"protocol":"openai"}}`
	channel := &Channel{
		Models:  "gpt-4o,gpt-4.1",
		Setting: &raw,
	}

	if err := channel.ValidateProtocolSettings(); err != nil {
		t.Fatalf("ValidateProtocolSettings() error = %v", err)
	}
}

func TestResolveProtocolBindingRejectsUndeclaredProtocolOption(t *testing.T) {
	settings := dto.ChannelSettings{
		DefaultProtocol: &dto.ProtocolBinding{
			Protocol: constant.ProtocolOpenAI,
			Options:  map[string]string{"api_version": "v1"},
		},
	}

	if _, err := ResolveProtocolBinding(settings, "gpt-4o"); err == nil {
		t.Fatal("expected undeclared protocol option to fail")
	}
}
