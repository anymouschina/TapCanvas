package model

import (
	"math"
	"testing"
)

func replaceConfiguredPricingForTest(
	t *testing.T,
	pricing map[string]ModelPricingConfig,
) {
	t.Helper()
	configuredPricingLock.Lock()
	original := configuredPricingByModel
	configuredPricingByModel = pricing
	configuredPricingLock.Unlock()
	t.Cleanup(func() {
		configuredPricingLock.Lock()
		configuredPricingByModel = original
		configuredPricingLock.Unlock()
	})
}

func TestVideoSpecPriceCNYLinearSeedance(t *testing.T) {
	// -260128 走 canonical 归一到 doubao-seedance-2.0 的线性规则表。
	price, ok := VideoSpecPriceCNY("doubao-seedance-2-0-260128", "720p", 15)
	if !ok {
		t.Fatal("expected price for seedance 2.0 720p 15s")
	}
	if math.Abs(price-1.71*15) > 1e-9 {
		t.Fatalf("price = %v, want %v", price, 1.71*15)
	}

	price, ok = VideoSpecPriceCNY("doubao-seedance-2-0-260128", "480p", 4)
	if !ok || math.Abs(price-0.7945*4) > 1e-9 {
		t.Fatalf("480p 4s price = %v ok=%v, want %v", price, ok, 0.7945*4)
	}

	// canonical 表含 1080p 档
	price, ok = VideoSpecPriceCNY("doubao-seedance-2-0-260128", "1080p", 10)
	if !ok || math.Abs(price-3.8544*10) > 1e-9 {
		t.Fatalf("1080p 10s price = %v ok=%v, want %v", price, ok, 3.8544*10)
	}
}

func TestVideoSpecPriceCNYLinearSeedance25(t *testing.T) {
	price, ok := VideoSpecPriceCNY("doubao-seedance-2-5-260628", "720p", 30)
	if !ok || math.Abs(price-2.25*30) > 1e-9 {
		t.Fatalf("seedance 2.5 720p 30s price = %v ok=%v, want %v", price, ok, 2.25*30)
	}

	price, ok = VideoSpecPriceCNY("doubao-seedance-2-5", "480P", 4)
	if !ok || math.Abs(price-1.875*4) > 1e-9 {
		t.Fatalf("seedance 2.5 alias 480P 4s price = %v ok=%v, want %v", price, ok, 1.875*4)
	}
}

func TestVideoSpecPriceCNYConfiguredRuleIsAuthoritative(t *testing.T) {
	replaceConfiguredPricingForTest(t, map[string]ModelPricingConfig{
		"doubao-seedance-2-0-260128": {
			Currency:    PricingCurrencyCNY,
			BillingMode: PricingBillingModeLinearBySpec,
			Specs: []ModelPricingSpec{{
				Resolution:   "720p",
				CNYPerSecond: 2,
			}},
		},
	})

	price, ok := VideoSpecPriceCNY(
		"doubao-seedance-2-0-260128",
		"720p",
		5,
	)
	if !ok || math.Abs(price-10) > 1e-9 {
		t.Fatalf("configured price = %v ok=%v, want 10 true", price, ok)
	}
	if _, ok := VideoSpecPriceCNY(
		"doubao-seedance-2-0-260128",
		"480p",
		5,
	); ok {
		t.Fatal("missing configured resolution must not fall through to system default")
	}
}

func TestVideoSpecPriceCNYExactConfigPrecedesCanonicalConfig(t *testing.T) {
	replaceConfiguredPricingForTest(t, map[string]ModelPricingConfig{
		"doubao-seedance-2.0": {
			Currency:    PricingCurrencyCNY,
			BillingMode: PricingBillingModeLinearBySpec,
			Specs: []ModelPricingSpec{{
				Resolution:   "720p",
				CNYPerSecond: 3,
			}},
		},
		"doubao-seedance-2-0-260128": {
			Currency:    PricingCurrencyCNY,
			BillingMode: PricingBillingModeLinearBySpec,
			Specs: []ModelPricingSpec{{
				Resolution:   "720p",
				CNYPerSecond: 2,
			}},
		},
	})

	price, ok := VideoSpecPriceCNY(
		"doubao-seedance-2-0-260128",
		"720p",
		5,
	)
	if !ok || math.Abs(price-10) > 1e-9 {
		t.Fatalf("exact model price = %v ok=%v, want 10 true", price, ok)
	}
}

func TestVideoSpecPriceCNYExplicitDisableBlocksSystemDefault(t *testing.T) {
	replaceConfiguredPricingForTest(t, map[string]ModelPricingConfig{
		"doubao-seedance-2-0-260128": DisabledModelPricingConfig(),
	})
	if _, ok := VideoSpecPriceCNY(
		"doubao-seedance-2-0-260128",
		"720p",
		5,
	); ok {
		t.Fatal("explicit disable must block the Seedance system-default rule")
	}
}

func TestEffectiveFixedSpecPriceCNYExplicitDisableBlocksImageDefault(t *testing.T) {
	replaceConfiguredPricingForTest(t, map[string]ModelPricingConfig{
		"gpt-image-2": DisabledModelPricingConfig(),
	})
	if _, ok := EffectiveFixedSpecPriceCNY("gpt-image-2", "2k", 0); ok {
		t.Fatal("explicit disable must block the gpt-image-2 system-default rule")
	}
	if _, ok := effectivePublishedBasePriceCNY("gpt-image-2"); ok {
		t.Fatal("explicit disable must block the gpt-image-2 system-default base price")
	}
}

func TestEffectiveFixedImageSpecPriceCNYUsesQualityAndResolution(t *testing.T) {
	replaceConfiguredPricingForTest(t, map[string]ModelPricingConfig{})

	tests := []struct {
		resolution string
		quality    string
		want       float64
	}{
		{resolution: "1K", quality: "auto", want: 0.3},
		{resolution: "2k", quality: "medium", want: 1.2},
		{resolution: "4K", quality: "high", want: 7.6},
	}
	for _, test := range tests {
		price, ok := EffectiveFixedImageSpecPriceCNY("gpt-image-2", test.resolution, test.quality)
		if !ok || math.Abs(price-test.want) > 1e-9 {
			t.Fatalf("%s/%s price = %v ok=%v, want %v true", test.resolution, test.quality, price, ok, test.want)
		}
	}
	if _, ok := EffectiveFixedImageSpecPriceCNY("gpt-image-2", "2k", "ultra"); ok {
		t.Fatal("unknown gpt-image-2 quality must not resolve a price")
	}
}

func TestConfiguredImageQualityMatrixDoesNotFallThroughToAnotherQuality(t *testing.T) {
	replaceConfiguredPricingForTest(t, map[string]ModelPricingConfig{
		"gpt-image-2": {
			Currency:    PricingCurrencyCNY,
			BillingMode: PricingBillingModeFixedBySpec,
			Specs: []ModelPricingSpec{
				{SpecKey: "image:2k:low", Resolution: "2k", PriceCNY: 0.4},
				{SpecKey: "image:2k:high", Resolution: "2k", PriceCNY: 4.6},
			},
		},
	})
	if _, ok := EffectiveFixedImageSpecPriceCNY("gpt-image-2", "2k", "medium"); ok {
		t.Fatal("missing configured medium row must not collapse to low")
	}
}

func TestConfiguredGptImageQualityDoesNotFallThroughToLegacyResolutionPrice(t *testing.T) {
	replaceConfiguredPricingForTest(t, map[string]ModelPricingConfig{
		"gpt-image-2": {
			Currency:    PricingCurrencyCNY,
			BillingMode: PricingBillingModeFixedBySpec,
			Specs: []ModelPricingSpec{
				{SpecKey: "image:2k", Resolution: "2k", PriceCNY: 0.4},
			},
		},
	})
	if _, ok := EffectiveFixedImageSpecPriceCNY("gpt-image-2", "2k", "high"); ok {
		t.Fatal("quality-qualified gpt-image-2 request must not use a legacy resolution-only price")
	}
}

func TestEffectivePublishedBasePriceDoesNotTreatLinearRateAsPerRequestPrice(t *testing.T) {
	replaceConfiguredPricingForTest(t, map[string]ModelPricingConfig{})

	if _, ok := effectivePublishedBasePriceCNY("doubao-seedance-2-0-260128"); ok {
		t.Fatal("a built-in CNY/second video rate must not replace model_price")
	}
	price, ok := effectivePublishedBasePriceCNY("gpt-image-2")
	if !ok || math.Abs(price-0.3) > 1e-9 {
		t.Fatalf("fixed image base price = %v ok=%v, want 0.3 true", price, ok)
	}
}

func TestVideoSpecPriceCNYResolutionCaseInsensitive(t *testing.T) {
	price, ok := VideoSpecPriceCNY("doubao-seedance-2-0-fast-260128", "720P", 10)
	if !ok || math.Abs(price-1.3753*10) > 1e-9 {
		t.Fatalf("fast 720P 10s price = %v ok=%v", price, ok)
	}
}

func TestVideoSpecPriceCNYFixedSpecs(t *testing.T) {
	price, ok := VideoSpecPriceCNY("omni-flash-ext", "4k", 8)
	if !ok || math.Abs(price-3.9420) > 1e-9 {
		t.Fatalf("omni-flash-ext 4k 8s price = %v ok=%v", price, ok)
	}
	// 固定规格表没有的时长不做线性外推
	if _, ok := VideoSpecPriceCNY("omni-flash-ext", "4k", 5); ok {
		t.Fatal("expected no price for unlisted fixed duration")
	}
}

func TestVideoSpecPriceCNYMisses(t *testing.T) {
	if _, ok := VideoSpecPriceCNY("doubao-seed3d-2-0-260328", "720p", 5); ok {
		t.Fatal("seed3d has no video spec pricing")
	}
	if _, ok := VideoSpecPriceCNY("doubao-seedance-2-0-260128", "", 5); ok {
		t.Fatal("empty resolution must miss")
	}
	if _, ok := VideoSpecPriceCNY("doubao-seedance-2-0-260128", "720p", 0); ok {
		t.Fatal("non-positive duration must miss")
	}
}

func TestMaxChannelPriceRatioByCanonicalModel(t *testing.T) {
	abilities := []AbilityWithChannel{
		{Ability: Ability{Model: "doubao-seedance-2.0", ChannelId: 1}, ChannelSetting: `{"price_ratio":1.5}`},
		{Ability: Ability{Model: "doubao-seedance-2-0-260128", ChannelId: 2}, ChannelSetting: ""},
		{Ability: Ability{Model: "kling-v3", ChannelId: 3}, ChannelSetting: `{"proxy":""}`},
		{Ability: Ability{Model: "kling-o3", ChannelId: 4}, ChannelSetting: `{"price_ratio":0.5}`},
	}
	out := maxChannelPriceRatioByCanonicalModel(abilities)
	// -260128 与 2.0 同 canonical，取最高 1.5
	if got := out["doubao-seedance-2.0"]; got != 1.5 {
		t.Fatalf("seedance max ratio = %v, want 1.5", got)
	}
	if got := out["kling-v3"]; got != 1.0 {
		t.Fatalf("kling ratio = %v, want 1.0", got)
	}
	if got := out["kling-o3"]; got != 0.5 {
		t.Fatalf("kling-o3 ratio = %v, want 0.5", got)
	}
}

func TestPricingModelReferenceByCanonicalModel(t *testing.T) {
	abilities := []AbilityWithChannel{
		{
			Ability:        Ability{Model: "seedance-2.0-funai", ChannelId: 71},
			ChannelSetting: `{"pricing_model_mapping":{"seedance-2.0-funai":"seedance-2.0"}}`,
		},
		{Ability: Ability{Model: "kling-v3", ChannelId: 3}, ChannelSetting: `{}`},
	}
	out, err := pricingModelReferenceByCanonicalModel(abilities)
	if err != nil {
		t.Fatalf("pricingModelReferenceByCanonicalModel: %v", err)
	}
	if got := out["seedance-2.0-funai"]; got != "seedance-2.0" {
		t.Fatalf("seedance price source = %q, want seedance-2.0", got)
	}
	if got := out["kling-v3"]; got != "kling-v3" {
		t.Fatalf("kling identity source = %q, want kling-v3", got)
	}
}

func TestMaxChannelVideoPriceFloorByCanonicalModel(t *testing.T) {
	abilities := []AbilityWithChannel{
		{Ability: Ability{Model: "kling-o3-funai", ChannelId: 71}, ChannelSetting: `{"min_video_price_cny_per_second":0.3}`},
		{Ability: Ability{Model: "kling-o3-funai", ChannelId: 72}, ChannelSetting: `{"min_video_price_cny_per_second":0.2}`},
	}
	out := maxChannelVideoPriceFloorByCanonicalModel(abilities)
	if got := out["kling-o3-funai"]; got != 0.3 {
		t.Fatalf("video price floor = %v, want 0.3", got)
	}
}

func TestPricingModelReferenceRejectsConflicts(t *testing.T) {
	abilities := []AbilityWithChannel{
		{
			Ability:        Ability{Model: "kling-v3-funai", ChannelId: 71},
			ChannelSetting: `{"pricing_model_mapping":{"kling-v3-funai":"kling-v3"}}`,
		},
		{Ability: Ability{Model: "kling-v3-funai", ChannelId: 72}, ChannelSetting: `{}`},
	}
	if _, err := pricingModelReferenceByCanonicalModel(abilities); err == nil {
		t.Fatal("expected conflicting price sources to fail")
	}
}

func TestApplyChannelPricingContractToPricing(t *testing.T) {
	p := Pricing{
		QuotaType:  1,
		ModelPrice: 10,
		ParamPricing: &ParamPricing{
			ReferenceImagePriceCNY: 0.1,
			Results: []ParamPricingResult{
				{SpecKey: "video:720p:5s", PriceCNY: 8.55, PriceDisplayCNY: "¥8.550000"},
			},
		},
	}
	applyChannelPricingContractToPricing(&p, 1.2, 0)
	if math.Abs(p.ModelPrice-12) > 1e-9 {
		t.Fatalf("model price = %v, want 12", p.ModelPrice)
	}
	if math.Abs(p.ParamPricing.Results[0].PriceCNY-10.26) > 1e-9 {
		t.Fatalf("spec price = %v, want 10.26", p.ParamPricing.Results[0].PriceCNY)
	}
	if math.Abs(p.ParamPricing.ReferenceImagePriceCNY-0.12) > 1e-9 {
		t.Fatalf("reference image price = %v, want 0.12", p.ParamPricing.ReferenceImagePriceCNY)
	}
	if p.ParamPricing.Results[0].PriceDisplayCNY != "¥10.260000" {
		t.Fatalf("display = %q", p.ParamPricing.Results[0].PriceDisplayCNY)
	}
	if p.ParamPricing.Formula != "discounted_price_cny = source_price_cny * 1.200000; published_price_cny = discounted_price_cny" {
		t.Fatalf("formula = %q", p.ParamPricing.Formula)
	}
}

func TestApplyChannelPricingContractUsesPerSecondFloor(t *testing.T) {
	p := Pricing{
		QuotaType:  1,
		ModelPrice: 0.18,
		ParamPricing: &ParamPricing{
			Formula: "720p: price_cny = duration_seconds * 0.06",
			Results: []ParamPricingResult{
				{SpecKey: "video:720p:3s", DurationSeconds: 3, PriceCNY: 0.18},
				{SpecKey: "video:720p:15s", DurationSeconds: 15, PriceCNY: 0.9},
			},
		},
	}
	applyChannelPricingContractToPricing(&p, 0.5, 0.3)
	if math.Abs(p.ParamPricing.Results[0].PriceCNY-0.9) > 1e-9 ||
		math.Abs(p.ParamPricing.Results[1].PriceCNY-4.5) > 1e-9 {
		t.Fatalf("floor prices = %+v", p.ParamPricing.Results)
	}
	if math.Abs(p.ModelPrice-0.9) > 1e-9 {
		t.Fatalf("base price = %v, want minimum published spec 0.9", p.ModelPrice)
	}
}
