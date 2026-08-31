package model

import (
	"math"
	"testing"
)

func TestSeedreamProPricingConfigPublishesAllFixedSpecs(t *testing.T) {
	config, err := ParseModelPricingConfig(`{
		"currency":"CNY",
		"billing_mode":"fixed_by_spec",
		"specs":[
			{"spec_key":"image:default","resolution":"default","price_cny":0.5},
			{"spec_key":"image:1k","resolution":"1k","price_cny":0.5},
			{"spec_key":"image:2k","resolution":"2k","price_cny":0.6}
		]
	}`)
	if err != nil {
		t.Fatalf("ParseModelPricingConfig() error = %v", err)
	}
	if config == nil {
		t.Fatal("expected pricing config")
	}
	pricing := buildConfiguredParamPricing(*config, nil)
	if pricing == nil || len(pricing.Results) != 3 {
		t.Fatalf("expected three fixed specs, got %#v", pricing)
	}
	for _, expected := range []struct {
		resolution string
		price      float64
	}{
		{resolution: "default", price: 0.5},
		{resolution: "1k", price: 0.5},
		{resolution: "2k", price: 0.6},
	} {
		price, ok := config.FixedPriceCNY(expected.resolution, 0)
		if !ok || math.Abs(price-expected.price) > 1e-9 {
			t.Fatalf("%s price = %v, %v; want %v, true", expected.resolution, price, ok, expected.price)
		}
	}
}

func TestLinearPricingConfigExpandsModelDurationSpecs(t *testing.T) {
	config, err := ParseModelPricingConfig(`{
		"currency":"CNY",
		"billing_mode":"linear_by_duration_and_resolution",
		"specs":[{"resolution":"720p","cny_per_second":0.5}]
	}`)
	if err != nil {
		t.Fatalf("ParseModelPricingConfig() error = %v", err)
	}
	meta := &Model{ParamsDef: `[{"key":"duration","options":[{"value":4},{"value":8}]}]`}
	pricing := buildConfiguredParamPricing(*config, meta)
	if pricing == nil || len(pricing.Results) != 2 {
		t.Fatalf("expected two linear specs, got %#v", pricing)
	}
	price, ok := config.LinearPriceCNY("720p", 8)
	if !ok || math.Abs(price-4) > 1e-9 {
		t.Fatalf("720p 8s price = %v, %v; want 4, true", price, ok)
	}
	if price, ok := config.BasePriceCNY(); ok {
		t.Fatalf("linear CNY/second rate returned per-request base %v", price)
	}
}

func TestDisabledPricingConfigRequiresEmptySpecs(t *testing.T) {
	config := DisabledModelPricingConfig()
	if err := config.Validate(); err != nil {
		t.Fatalf("disabled pricing config should be valid: %v", err)
	}
	if config.Specs == nil {
		t.Fatal("disabled pricing config must serialize specs as [] instead of null")
	}

	config.Specs = []ModelPricingSpec{{
		Resolution: "720p",
		PriceCNY:   1,
	}}
	if err := config.Validate(); err == nil {
		t.Fatal("disabled pricing config with specs should fail")
	}
}

func TestFixedPricingConfigAllowsQualityRowsAtOneResolution(t *testing.T) {
	config, err := ParseModelPricingConfig(`{
		"currency":"CNY",
		"billing_mode":"fixed_by_spec",
		"reference_image_price_cny":0.1,
		"specs":[
			{"spec_key":"image:2k:low","resolution":"2k","price_cny":0.4},
			{"spec_key":"image:2k:medium","resolution":"2k","price_cny":1.2},
			{"spec_key":"image:2k:high","resolution":"2k","price_cny":4.6}
		]
	}`)
	if err != nil {
		t.Fatalf("ParseModelPricingConfig() error = %v", err)
	}
	if config == nil {
		t.Fatal("expected pricing config")
	}
	price, ok := config.FixedPriceCNYBySpecKey("IMAGE:2K:HIGH")
	if !ok || math.Abs(price-4.6) > 1e-9 {
		t.Fatalf("high price = %v, %v; want 4.6, true", price, ok)
	}
	if math.Abs(config.ReferenceImagePriceCNY-0.1) > 1e-9 {
		t.Fatalf("reference image price = %v, want 0.1", config.ReferenceImagePriceCNY)
	}
}

func TestFixedPricingConfigRejectsDuplicateExplicitSpecKey(t *testing.T) {
	_, err := ParseModelPricingConfig(`{
		"currency":"CNY",
		"billing_mode":"fixed_by_spec",
		"specs":[
			{"spec_key":"image:2k:high","resolution":"2k","price_cny":4.6},
			{"spec_key":"IMAGE:2K:HIGH","resolution":"2k","price_cny":4.7}
		]
	}`)
	if err == nil {
		t.Fatal("duplicate explicit spec_key should fail")
	}
}

func TestResolveEffectivePricingExposesSeedanceSystemDefault(t *testing.T) {
	config, source, err := resolveEffectiveModelPricingConfig(
		"doubao-seedance-2-0-260128",
		"",
	)
	if err != nil {
		t.Fatalf("resolve effective pricing failed: %v", err)
	}
	if source != SpecPricingSourceSystemDefault {
		t.Fatalf("source = %q, want %q", source, SpecPricingSourceSystemDefault)
	}
	if config == nil || config.BillingMode != PricingBillingModeLinearBySpec {
		t.Fatalf("effective config = %#v", config)
	}
	if len(config.Specs) != 3 {
		t.Fatalf("len(specs) = %d, want 3", len(config.Specs))
	}
}

func TestResolveEffectivePricingHonorsExplicitDisable(t *testing.T) {
	config, source, err := resolveEffectiveModelPricingConfig(
		"doubao-seedance-2-0-260128",
		`{"currency":"CNY","billing_mode":"disabled","specs":[]}`,
	)
	if err != nil {
		t.Fatalf("resolve effective pricing failed: %v", err)
	}
	if config != nil {
		t.Fatalf("disabled effective config = %#v, want nil", config)
	}
	if source != SpecPricingSourceDisabled {
		t.Fatalf("source = %q, want %q", source, SpecPricingSourceDisabled)
	}
}

func TestSystemDefaultVideoPricingConfigsSatisfyPersistedContract(t *testing.T) {
	modelNames := make(map[string]struct{}, len(linearVideoPricingRules)+len(fixedVideoPricingSpecs))
	for modelName := range linearVideoPricingRules {
		modelNames[modelName] = struct{}{}
	}
	for modelName := range fixedVideoPricingSpecs {
		modelNames[modelName] = struct{}{}
	}

	for modelName := range modelNames {
		config := systemDefaultModelPricingConfig(modelName)
		if config == nil {
			t.Fatalf("system default config for %q is nil", modelName)
		}
		if err := config.Validate(); err != nil {
			t.Fatalf("system default config for %q is invalid: %v", modelName, err)
		}
	}
}
