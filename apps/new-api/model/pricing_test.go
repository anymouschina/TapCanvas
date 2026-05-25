package model

import (
	"math"
	"testing"
)

func TestBuildParamPricingForSeedance(t *testing.T) {
	meta := &Model{
		ModelName: "doubao-seedance-2-0-260128",
		ParamsDef: `[
			{"key":"duration","type":"enum","label":"时长","default":4,
			 "options":[
			   {"value":4,"label":"4s"},
			   {"value":6,"label":"6s"}
			 ]},
			{"key":"resolution","type":"enum","label":"分辨率","default":"480p",
			 "options":[{"value":"480p","label":"480p"},{"value":"720p","label":"720p"}]}
		]`,
	}

	pricing := buildParamPricing("doubao-seedance-2-0-260128", meta)
	if pricing == nil {
		t.Fatal("expected param pricing")
	}
	if pricing.Currency != "CNY" {
		t.Fatalf("currency = %q", pricing.Currency)
	}
	if pricing.BillingMode != "linear_by_duration_and_resolution" {
		t.Fatalf("billing mode = %q", pricing.BillingMode)
	}
	if len(pricing.Results) != 6 {
		t.Fatalf("len(results) = %d", len(pricing.Results))
	}

	assertSpecPriceCNY := func(specKey string, want float64) {
		t.Helper()
		for _, item := range pricing.Results {
			if item.SpecKey != specKey {
				continue
			}
			if math.Abs(item.PriceCNY-want) > 1e-9 {
				t.Fatalf("%s price_cny = %.6f, want %.6f", specKey, item.PriceCNY, want)
			}
			return
		}
		t.Fatalf("spec %s not found", specKey)
	}

	assertSpecPriceCNY("video:480p:4s", 0.7945*4)
	assertSpecPriceCNY("video:480p:6s", 0.7945*6)
	assertSpecPriceCNY("video:720p:4s", 1.7100*4)
	assertSpecPriceCNY("video:720p:6s", 1.7100*6)
	assertSpecPriceCNY("video:1080p:4s", 3.8544*4)
	assertSpecPriceCNY("video:1080p:6s", 3.8544*6)
}

func TestBuildParamPricingForSeedanceFaceAddsTenPercent(t *testing.T) {
	meta := &Model{
		ModelName: "doubao-seedance-2.0-face",
		ParamsDef: `[
			{"key":"duration","type":"enum","label":"时长","default":4,
			 "options":[
			   {"value":4,"label":"4s"},
			   {"value":6,"label":"6s"}
			 ]},
			{"key":"resolution","type":"enum","label":"分辨率","default":"480p",
			 "options":[{"value":"480p","label":"480p"},{"value":"720p","label":"720p"}]}
		]`,
	}

	pricing := buildParamPricing("doubao-seedance-2.0-face", meta)
	if pricing == nil {
		t.Fatal("expected param pricing")
	}
	if pricing.Formula != "480p: price_cny = duration_seconds * 1.09; 720p: price_cny = duration_seconds * 2.34; 1080p: price_cny = duration_seconds * 5.47" {
		t.Fatalf("formula = %q", pricing.Formula)
	}

	assertSpecPriceCNY := func(specKey string, want float64) {
		t.Helper()
		for _, item := range pricing.Results {
			if item.SpecKey != specKey {
				continue
			}
			if math.Abs(item.PriceCNY-want) > 1e-9 {
				t.Fatalf("%s price_cny = %.6f, want %.6f", specKey, item.PriceCNY, want)
			}
			return
		}
		t.Fatalf("spec %s not found", specKey)
	}

	assertSpecPriceCNY("video:480p:4s", 1.0862*4)
	assertSpecPriceCNY("video:480p:6s", 1.0862*6)
	assertSpecPriceCNY("video:720p:4s", 2.3389*4)
	assertSpecPriceCNY("video:720p:6s", 2.3389*6)
	assertSpecPriceCNY("video:1080p:4s", 5.4750*4)
}

func TestBuildParamPricingForSeedanceFastFaceAddsTenPercent(t *testing.T) {
	meta := &Model{
		ModelName: "doubao-seedance-2.0-fast-face",
		ParamsDef: `[
			{"key":"duration","type":"enum","label":"时长","default":4,
			 "options":[
			   {"value":4,"label":"4s"},
			   {"value":6,"label":"6s"}
			 ]},
			{"key":"resolution","type":"enum","label":"分辨率","default":"480p",
			 "options":[{"value":"480p","label":"480p"},{"value":"720p","label":"720p"}]}
		]`,
	}

	pricing := buildParamPricing("doubao-seedance-2.0-fast-face", meta)
	if pricing == nil {
		t.Fatal("expected param pricing")
	}
	if pricing.Formula != "480p: price_cny = duration_seconds * 0.88; 720p: price_cny = duration_seconds * 1.88" {
		t.Fatalf("formula = %q", pricing.Formula)
	}

	assertSpecPriceCNY := func(specKey string, want float64) {
		t.Helper()
		for _, item := range pricing.Results {
			if item.SpecKey != specKey {
				continue
			}
			if math.Abs(item.PriceCNY-want) > 1e-9 {
				t.Fatalf("%s price_cny = %.6f, want %.6f", specKey, item.PriceCNY, want)
			}
			return
		}
		t.Fatalf("spec %s not found", specKey)
	}

	assertSpecPriceCNY("video:480p:4s", 0.8760*4)
	assertSpecPriceCNY("video:480p:6s", 0.8760*6)
	assertSpecPriceCNY("video:720p:4s", 1.8834*4)
	assertSpecPriceCNY("video:720p:6s", 1.8834*6)
}

func TestBuildParamPricingForGptImage2UsesTwoXSimpleSpecs(t *testing.T) {
	pricing := buildParamPricing("gpt-image-2", nil)
	if pricing == nil {
		t.Fatal("expected param pricing")
	}
	if pricing.Currency != "CNY" {
		t.Fatalf("currency = %q", pricing.Currency)
	}

	assertSpecPriceCNY := func(specKey string, want float64) {
		t.Helper()
		for _, item := range pricing.Results {
			if item.SpecKey != specKey {
				continue
			}
			if math.Abs(item.PriceCNY-want) > 1e-9 {
				t.Fatalf("%s price_cny = %.6f, want %.6f", specKey, item.PriceCNY, want)
			}
			return
		}
		t.Fatalf("spec %s not found", specKey)
	}

	assertSpecPriceCNY("image:1k", 0.2)
	assertSpecPriceCNY("image:2k", 0.3)
	assertSpecPriceCNY("image:4k", 0.4)
}

func TestBuildParamPricingForGeminiImageOfficialUsesFourTimesPremiumCNY(t *testing.T) {
	pricing := buildParamPricing("gemini-3.1-flash-image-preview-official", nil)
	if pricing == nil {
		t.Fatal("expected param pricing")
	}
	if pricing.Currency != "CNY" {
		t.Fatalf("currency = %q", pricing.Currency)
	}

	assertSpecPriceCNY := func(specKey string, want float64) {
		t.Helper()
		for _, item := range pricing.Results {
			if item.SpecKey != specKey {
				continue
			}
			if math.Abs(item.PriceCNY-want) > 1e-9 {
				t.Fatalf("%s price_cny = %.6f, want %.6f", specKey, item.PriceCNY, want)
			}
			return
		}
		t.Fatalf("spec %s not found", specKey)
	}

	assertSpecPriceCNY("image:1k", 0.6)
	assertSpecPriceCNY("image:2k", 0.7)
	assertSpecPriceCNY("image:4k", 1.1)
}

func TestFixedImageBasePriceCNYUsesLowestSpec(t *testing.T) {
	gptImage2Price, ok := fixedImageBasePriceCNY("gpt-image-2")
	if !ok {
		t.Fatal("expected gpt-image-2 base price")
	}
	if math.Abs(gptImage2Price-0.2) > 1e-9 {
		t.Fatalf("gpt-image-2 base price = %.6f", gptImage2Price)
	}

	officialPrice, ok := fixedImageBasePriceCNY("gpt-image-2-official")
	if !ok {
		t.Fatal("expected gpt-image-2-official base price")
	}
	if math.Abs(officialPrice-1.5) > 1e-9 {
		t.Fatalf("gpt-image-2-official base price = %.6f", officialPrice)
	}
}

func TestBuildParamPricingForGptImage2OfficialUsesSimpleSpecs(t *testing.T) {
	pricing := buildParamPricing("gpt-image-2-official", nil)
	if pricing == nil {
		t.Fatal("expected param pricing")
	}
	if pricing.Currency != "CNY" {
		t.Fatalf("currency = %q", pricing.Currency)
	}

	assertSpecPriceCNY := func(specKey string, want float64) {
		t.Helper()
		for _, item := range pricing.Results {
			if item.SpecKey != specKey {
				continue
			}
			if math.Abs(item.PriceCNY-want) > 1e-9 {
				t.Fatalf("%s price_cny = %.6f, want %.6f", specKey, item.PriceCNY, want)
			}
			return
		}
		t.Fatalf("spec %s not found", specKey)
	}

	assertSpecPriceCNY("image:1k", 1.5)
	assertSpecPriceCNY("image:2k", 1.8)
	assertSpecPriceCNY("image:4k", 2.5)
}

func TestBuildParamPricingForSora2UsesFixedDurationPrices(t *testing.T) {
	meta := &Model{
		ModelName: "sora2",
		ParamsDef: `[
			{"key":"duration","type":"enum","label":"时长","default":4,
			 "options":[
			   {"value":4,"label":"4s"},
			   {"value":8,"label":"8s"},
			   {"value":12,"label":"12s"}
			 ]},
			{"key":"resolution","type":"enum","label":"分辨率","default":"720p",
			 "options":[{"value":"720p","label":"720p"}]}
		]`,
	}

	pricing := buildParamPricing("sora2", meta)
	if pricing == nil {
		t.Fatal("expected param pricing")
	}
	if pricing.Currency != "CNY" {
		t.Fatalf("currency = %q", pricing.Currency)
	}

	assertSpecPriceCNY := func(specKey string, want float64) {
		t.Helper()
		for _, item := range pricing.Results {
			if item.SpecKey != specKey {
				continue
			}
			if math.Abs(item.PriceCNY-want) > 1e-9 {
				t.Fatalf("%s price_cny = %.6f, want %.6f", specKey, item.PriceCNY, want)
			}
			return
		}
		t.Fatalf("spec %s not found", specKey)
	}

	assertSpecPriceCNY("video:720p:4s", 0.4)
	assertSpecPriceCNY("video:720p:8s", 0.8)
	assertSpecPriceCNY("video:720p:12s", 1.2)
}
