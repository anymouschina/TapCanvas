package model

import (
	"math"
	"reflect"
	"testing"

	"github.com/QuantumNous/new-api/common"
)

const modelPricingPolicyTestName = "model-pricing-policy-test"

func prepareModelPricingPolicyTest(t *testing.T) Model {
	t.Helper()
	if err := DB.AutoMigrate(&Model{}, &Option{}); err != nil {
		t.Fatalf("failed to migrate pricing policy tables: %v", err)
	}
	common.OptionMapRWMutex.Lock()
	optionMapWasNil := common.OptionMap == nil
	if optionMapWasNil {
		common.OptionMap = make(map[string]string)
	}
	common.OptionMapRWMutex.Unlock()
	originalMaps := loadModelPricingOptionMaps()
	meta := Model{
		ModelName: modelPricingPolicyTestName,
		NameRule:  NameRuleExact,
		Status:    1,
	}
	if err := DB.Create(&meta).Error; err != nil {
		t.Fatalf("failed to create model: %v", err)
	}
	t.Cleanup(func() {
		if err := ReplaceModelPricingOptionMaps(originalMaps); err != nil {
			t.Errorf("failed to restore pricing option maps: %v", err)
		}
		if optionMapWasNil {
			common.OptionMapRWMutex.Lock()
			common.OptionMap = nil
			common.OptionMapRWMutex.Unlock()
		}
		DB.Unscoped().Delete(&Model{}, meta.Id)
	})
	return meta
}

func pricingFloat(value float64) *float64 {
	return &value
}

func pricingCurrency(value string) *string {
	return &value
}

func assertPricingFloat(t *testing.T, label string, actual *float64, expected float64) {
	t.Helper()
	if actual == nil {
		t.Fatalf("%s is nil", label)
	}
	if math.Abs(*actual-expected) > 1e-9 {
		t.Fatalf("%s = %g, want %g", label, *actual, expected)
	}
}

func TestUpdateModelPricingPolicyStoresHumanPricesAsOnePolicy(t *testing.T) {
	meta := prepareModelPricingPolicyTest(t)
	specPricing := &ModelPricingConfig{
		Currency:    PricingCurrencyCNY,
		BillingMode: PricingBillingModeFixedBySpec,
		Specs: []ModelPricingSpec{{
			SpecKey:    "image:2k",
			Resolution: "2k",
			PriceCNY:   0.8,
		}},
	}
	policy, err := UpdateModelPricingPolicy(meta.Id, ModelPricingPolicyUpdate{
		BillingMode:                  ModelPricingModePerToken,
		InputPriceUSDPerMillion:      pricingFloat(10),
		OutputPriceUSDPerMillion:     pricingFloat(30),
		CacheReadPriceUSDPerMillion:  pricingFloat(1),
		CacheWritePriceUSDPerMillion: pricingFloat(12.5),
		ImageInputPriceUSDPerMillion: pricingFloat(20),
		SpecPricing:                  specPricing,
	})
	if err != nil {
		t.Fatalf("update pricing policy failed: %v", err)
	}

	if policy.BillingMode != ModelPricingModePerToken {
		t.Fatalf("billing mode = %q", policy.BillingMode)
	}
	assertPricingFloat(t, "input price", policy.InputPriceUSDPerMillion, 10)
	assertPricingFloat(t, "output price", policy.OutputPriceUSDPerMillion, 30)
	assertPricingFloat(t, "model ratio", policy.Ratios.ModelRatio, 5)
	assertPricingFloat(t, "completion ratio", policy.Ratios.CompletionRatio, 3)
	assertPricingFloat(t, "cache ratio", policy.Ratios.CacheRatio, 0.1)
	assertPricingFloat(t, "create cache ratio", policy.Ratios.CreateCacheRatio, 1.25)
	assertPricingFloat(t, "image ratio", policy.Ratios.ImageRatio, 2)
	if policy.SpecPricing == nil || len(policy.SpecPricing.Specs) != 1 {
		t.Fatalf("spec pricing was not returned: %#v", policy.SpecPricing)
	}

	reloaded, err := GetModelPricingPolicy(meta.Id)
	if err != nil {
		t.Fatalf("reload pricing policy failed: %v", err)
	}
	assertPricingFloat(t, "reloaded output price", reloaded.OutputPriceUSDPerMillion, 30)
	if reloaded.SpecPricing == nil || reloaded.SpecPricing.Specs[0].PriceCNY != 0.8 {
		t.Fatalf("reloaded spec pricing = %#v", reloaded.SpecPricing)
	}
}

func TestUpdateModelPricingPolicyHardCutsConflictingModeValues(t *testing.T) {
	meta := prepareModelPricingPolicyTest(t)
	_, err := UpdateModelPricingPolicy(meta.Id, ModelPricingPolicyUpdate{
		BillingMode:             ModelPricingModePerRequest,
		FixedPrice:              pricingFloat(0.25),
		FixedPriceCurrency:      pricingCurrency(FixedPriceCurrencyUSD),
		InputPriceUSDPerMillion: pricingFloat(2),
	})
	if err == nil {
		t.Fatal("expected conflicting per-request and per-token values to fail")
	}
}

func TestUpdateModelPricingPolicyPersistsExplicitSpecDisable(t *testing.T) {
	meta := prepareModelPricingPolicyTest(t)
	policy, err := UpdateModelPricingPolicy(meta.Id, ModelPricingPolicyUpdate{
		BillingMode:        ModelPricingModePerRequest,
		FixedPrice:         pricingFloat(0.25),
		FixedPriceCurrency: pricingCurrency(FixedPriceCurrencyUSD),
		SpecPricing:        nil,
	})
	if err != nil {
		t.Fatalf("update pricing policy failed: %v", err)
	}
	if policy.SpecPricing != nil {
		t.Fatalf("disabled policy returned spec pricing: %#v", policy.SpecPricing)
	}
	if policy.SpecPricingSource != SpecPricingSourceDisabled {
		t.Fatalf(
			"spec pricing source = %q, want %q",
			policy.SpecPricingSource,
			SpecPricingSourceDisabled,
		)
	}

	var stored Model
	if err := DB.First(&stored, meta.Id).Error; err != nil {
		t.Fatalf("reload stored model failed: %v", err)
	}
	config, err := ParseModelPricingConfig(stored.PricingConfig)
	if err != nil {
		t.Fatalf("parse stored disabled pricing config failed: %v", err)
	}
	if config == nil || !config.IsDisabled() || config.Specs == nil {
		t.Fatalf("stored disabled pricing config = %#v", config)
	}
}

func TestUpdateModelPricingPolicyRequiresCNYForMediaRequestPrice(t *testing.T) {
	meta := prepareModelPricingPolicyTest(t)
	if err := DB.Model(&Model{}).Where("id = ?", meta.Id).Update("kind", "image").Error; err != nil {
		t.Fatalf("mark pricing test model as image failed: %v", err)
	}

	_, err := UpdateModelPricingPolicy(meta.Id, ModelPricingPolicyUpdate{
		BillingMode:        ModelPricingModePerRequest,
		FixedPrice:         pricingFloat(0.3),
		FixedPriceCurrency: pricingCurrency(FixedPriceCurrencyUSD),
	})
	if err == nil {
		t.Fatal("expected USD media request price to fail")
	}

	policy, err := UpdateModelPricingPolicy(meta.Id, ModelPricingPolicyUpdate{
		BillingMode:        ModelPricingModePerRequest,
		FixedPrice:         pricingFloat(0.3),
		FixedPriceCurrency: pricingCurrency(FixedPriceCurrencyCNY),
	})
	if err != nil {
		t.Fatalf("save CNY media request price failed: %v", err)
	}
	if policy.FixedPriceCurrency != FixedPriceCurrencyCNY {
		t.Fatalf("fixed price currency = %q, want %q", policy.FixedPriceCurrency, FixedPriceCurrencyCNY)
	}
	assertPricingFloat(t, "fixed price", policy.FixedPrice, 0.3)
}

func TestBuildModelPricingPolicyReturnsSaverSystemDefaultPriceTable(t *testing.T) {
	const saverModel = "gemini-3-pro-image-preview-saver"
	optionMaps := make(modelPricingOptionMaps, len(modelPricingOptionKeys))
	for _, key := range modelPricingOptionKeys {
		optionMaps[key] = make(map[string]float64)
	}
	optionMaps["ModelPrice"][saverModel] = 0.3

	policy, err := buildModelPricingPolicy(Model{
		Id:            505,
		ModelName:     saverModel,
		Kind:          "image",
		NameRule:      NameRuleExact,
		PricingConfig: "",
	}, optionMaps)
	if err != nil {
		t.Fatalf("build saver pricing policy failed: %v", err)
	}
	if policy.SpecPricingSource != SpecPricingSourceSystemDefault {
		t.Fatalf(
			"spec pricing source = %q, want %q",
			policy.SpecPricingSource,
			SpecPricingSourceSystemDefault,
		)
	}
	if policy.FixedPriceCurrency != FixedPriceCurrencyCNY {
		t.Fatalf("fixed price currency = %q, want %q", policy.FixedPriceCurrency, FixedPriceCurrencyCNY)
	}
	assertPricingFloat(t, "fixed price", policy.FixedPrice, 0.3)
	if policy.SpecPricing == nil {
		t.Fatal("saver policy is missing effective spec pricing")
	}
	if policy.SpecPricing.BillingMode != PricingBillingModeFixedBySpec {
		t.Fatalf(
			"spec billing mode = %q, want %q",
			policy.SpecPricing.BillingMode,
			PricingBillingModeFixedBySpec,
		)
	}
	if len(policy.SpecPricing.Specs) != 3 {
		t.Fatalf("spec count = %d, want 3", len(policy.SpecPricing.Specs))
	}

	expectedPrices := map[string]float64{
		"1k": 0.3,
		"2k": 0.3,
		"4k": 0.5,
	}
	for _, spec := range policy.SpecPricing.Specs {
		expected, exists := expectedPrices[spec.Resolution]
		if !exists {
			t.Fatalf("unexpected saver resolution %q", spec.Resolution)
		}
		if math.Abs(spec.PriceCNY-expected) > 1e-9 {
			t.Fatalf(
				"%s price = %g, want %g",
				spec.Resolution,
				spec.PriceCNY,
				expected,
			)
		}
		delete(expectedPrices, spec.Resolution)
	}
	if len(expectedPrices) != 0 {
		t.Fatalf("missing saver resolutions: %#v", expectedPrices)
	}
}

func TestReplaceModelPricingOptionMapsRequiresCompleteContract(t *testing.T) {
	err := ReplaceModelPricingOptionMaps(map[string]map[string]float64{
		"ModelPrice": {},
	})
	if err == nil {
		t.Fatal("expected incomplete pricing option maps to fail")
	}
}

func TestResetModelRatioToDefaultUsesCompleteAtomicContract(t *testing.T) {
	prepareModelPricingPolicyTest(t)
	before := loadModelPricingOptionMaps()
	before["ModelPrice"]["reset-model"] = 0.25
	if err := ReplaceModelPricingOptionMaps(before); err != nil {
		t.Fatalf("seed conflicting fixed price failed: %v", err)
	}
	before = loadModelPricingOptionMaps()

	if err := ResetModelRatioToDefault(`{"reset-model":1.25}`); err != nil {
		t.Fatalf("reset model ratio failed: %v", err)
	}
	after := loadModelPricingOptionMaps()
	if !reflect.DeepEqual(after["ModelRatio"], map[string]float64{"reset-model": 1.25}) {
		t.Fatalf("reset ModelRatio = %#v", after["ModelRatio"])
	}
	if _, exists := after["ModelPrice"]["reset-model"]; exists {
		t.Fatal("reset left conflicting ModelPrice for reset-model")
	}
	delete(before["ModelPrice"], "reset-model")
	if !reflect.DeepEqual(after["ModelPrice"], before["ModelPrice"]) {
		t.Fatal("reset changed unrelated fixed prices")
	}
	for _, key := range modelPricingOptionKeys {
		if key == "ModelRatio" || key == "ModelPrice" {
			continue
		}
		if !reflect.DeepEqual(after[key], before[key]) {
			t.Fatalf("reset unexpectedly changed %s", key)
		}
	}
}
