package controller

import (
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
)

func TestBuildGatewayReadinessRequiresEnabledModelAndConfiguredChannel(t *testing.T) {
	models := []model.Model{{ModelName: "image-model", Status: 1}}
	channels := []model.Channel{{Id: 7, Status: common.ChannelStatusEnabled}}
	abilities := []model.Ability{{Model: "image-model", ChannelId: 7, Enabled: true}}

	got := buildGatewayReadiness(models, channels, abilities)
	if got.Ready {
		t.Fatal("readiness must be false when the channel credential is empty")
	}
	if got.EnabledModelCount != 1 || got.ConfiguredChannelCount != 0 || got.ExecutableModelCount != 0 {
		t.Fatalf("unexpected counts: %+v", got)
	}
	if len(got.Reasons) != 1 || got.Reasons[0] != gatewayReadinessReasonNoConfiguredChannels {
		t.Fatalf("unexpected reasons: %v", got.Reasons)
	}
}

func TestBuildGatewayReadinessAcceptsCanonicalAliasAbility(t *testing.T) {
	models := []model.Model{{ModelName: "gpt-image-2", Status: 1}}
	channels := []model.Channel{{
		Id:     9,
		Status: common.ChannelStatusEnabled,
		Key:    "configured-locally",
	}}
	abilities := []model.Ability{{Model: "gpt-image-2-apimart", ChannelId: 9, Enabled: true}}

	got := buildGatewayReadiness(models, channels, abilities)
	if !got.Ready {
		t.Fatalf("expected ready gateway, got %+v", got)
	}
	if got.EnabledModelCount != 1 || got.ConfiguredChannelCount != 1 || got.ExecutableModelCount != 1 {
		t.Fatalf("unexpected counts: %+v", got)
	}
	if len(got.Reasons) != 0 {
		t.Fatalf("ready gateway must have no reasons: %v", got.Reasons)
	}
}

func TestBuildGatewayReadinessRejectsDisabledMultiKeyCredential(t *testing.T) {
	models := []model.Model{{ModelName: "text-model", Status: 1}}
	channels := []model.Channel{{
		Id:     11,
		Status: common.ChannelStatusEnabled,
		Key:    "first-key\nsecond-key",
		ChannelInfo: model.ChannelInfo{
			IsMultiKey:         true,
			MultiKeyStatusList: map[int]int{0: 2, 1: 2},
		},
	}}
	abilities := []model.Ability{{Model: "text-model", ChannelId: 11, Enabled: true}}

	got := buildGatewayReadiness(models, channels, abilities)
	if got.Ready || got.ConfiguredChannelCount != 0 {
		t.Fatalf("disabled multi-key credentials must not be executable: %+v", got)
	}
}
