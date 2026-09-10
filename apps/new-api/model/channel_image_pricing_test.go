package model

import (
	"encoding/json"
	"math"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/dto"
)

func channelPriceFixture(t *testing.T) dto.ChannelSettings {
	t.Helper()
	config := ModelPricingConfig{Currency: "CNY", BillingMode: PricingBillingModeFixedBySpec, ReferenceImagePriceCNY: .1}
	for _, res := range []struct {
		name  string
		price float64
	}{{"1k", .2}, {"2k", .3}, {"4k", .4}} {
		for _, quality := range []string{"low", "medium", "high"} {
			config.Specs = append(config.Specs, ModelPricingSpec{SpecKey: "image:" + res.name + ":" + quality, Resolution: res.name, PriceCNY: res.price})
		}
	}
	raw, err := common.Marshal(config)
	if err != nil {
		t.Fatal(err)
	}
	return dto.ChannelSettings{ImagePricingOverrides: map[string]json.RawMessage{"gpt-image-2": raw}}
}

func TestChannelImagePricingPreservesOtherChannelsAndMatchesQuote(t *testing.T) {
	settings := channelPriceFixture(t)
	for _, quality := range []string{"", "standard", "medium", "high", "hd"} {
		price, configured, err := ChannelImageRequestPriceCNY(settings, "gpt-image-2", "4K", quality, 2)
		if err != nil || !configured || math.Abs(price-.6) > 1e-9 {
			t.Fatalf("quality %q: %v %t %v", quality, price, configured, err)
		}
	}
	for _, empty := range []dto.ChannelSettings{{}, {ImagePricingOverrides: map[string]json.RawMessage{}}} {
		if _, configured, err := ChannelImageRequestPriceCNY(empty, "gpt-image-2", "4k", "high", 0); configured || err != nil {
			t.Fatal("overrides leaked to another channel")
		}
	}
	settings.PriceRatio = 1.5
	raw, err := common.Marshal(settings)
	if err != nil {
		t.Fatal(err)
	}
	row := AbilityWithChannel{Ability: Ability{ChannelId: 302, Model: "gpt-image-2"}, ChannelSetting: string(raw)}
	quotes, err := channelImagePricesByModel([]AbilityWithChannel{row, row})
	if err != nil {
		t.Fatal(err)
	}
	prices := quotes["gpt-image-2"]
	if len(prices) != 1 || prices[0].ChannelID != 302 || len(prices[0].ParamPricing.Results) != 9 {
		t.Fatalf("invalid channel quote: %+v", prices)
	}
	p := prices[0].ParamPricing
	for _, r := range p.Results {
		if r.SpecKey == "image:4k:high" && math.Abs(r.PriceCNY+2*p.ReferenceImagePriceCNY-.9) > 1e-9 {
			t.Fatalf("quote and settlement differ: %+v", p)
		}
	}
}

func TestChannelImagePricingRejectsBrokenOrMissingSpecifications(t *testing.T) {
	settings := channelPriceFixture(t)
	if _, configured, err := ChannelImageRequestPriceCNY(settings, "gpt-image-2", "8k", "high", 0); !configured || err == nil {
		t.Fatal("missing specification silently used shared price")
	}
	for _, raw := range []string{"null", "{}", `{"currency":"CNY","billing_mode":"disabled","specs":[]}`} {
		settings.ImagePricingOverrides["gpt-image-2"] = json.RawMessage(raw)
		if _, configured, err := ChannelImageRequestPriceCNY(settings, "gpt-image-2", "4k", "high", 0); !configured || err == nil {
			t.Fatalf("invalid config accepted: %s", raw)
		}
	}
}

func TestChannelImagePricingValidationRejectsUnboundModel(t *testing.T) {
	settings := channelPriceFixture(t)
	settings.DefaultProtocol = &dto.ProtocolBinding{Protocol: constant.ProtocolOpenAI}
	raw, err := common.Marshal(settings)
	if err != nil {
		t.Fatal(err)
	}
	value := string(raw)
	c := Channel{Type: constant.ChannelTypeCustom, Models: "another-image", Setting: &value}
	if err := c.ValidateProtocolSettings(); err == nil {
		t.Fatal("unbound price override accepted")
	}
}

func TestChannelImageFlatCostUsesDeliveredImageUnit(t *testing.T) {
	settings := dto.ChannelSettings{ImageCostPerImageCNY: map[string]float64{"example-image": .0875}, ImageSaleMultiplier: 2}
	for _, resolution := range []string{"", "1k", "2k", "4k"} {
		price, configured, err := ChannelImageRequestPriceCNY(settings, "example-image", resolution, "high", 3)
		if err != nil || !configured || math.Abs(price-.175) > 1e-9 {
			t.Fatalf("flat procurement price incorrect: %v %v %v", price, configured, err)
		}
	}
	if _, configured, err := ChannelImageRequestPriceCNY(settings, "other-model", "1k", "", 0); configured || err != nil {
		t.Fatal("cost contract leaked")
	}
	settings.ImageBillingUnit = "request"
	if _, _, err := ChannelImageRequestPriceCNY(settings, "example-image", "1k", "", 0); err == nil {
		t.Fatal("per-image cost must not bill by request")
	}
}
