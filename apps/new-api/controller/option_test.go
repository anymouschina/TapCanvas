package controller

import (
	"encoding/json"
	"testing"
)

func completePricingOptionValues() map[string]string {
	values := make(map[string]string, len(atomicModelPricingOptionKeys))
	for _, key := range atomicModelPricingOptionKeys {
		values[key] = "{}"
	}
	return values
}

func TestBuildCompletionRatioMetaValueRejectsMissingPricingMap(t *testing.T) {
	values := completePricingOptionValues()
	delete(values, "AudioRatio")

	if _, err := buildCompletionRatioMetaValue(values); err == nil {
		t.Fatal("expected a missing pricing map to fail")
	}
}

func TestBuildCompletionRatioMetaValueRejectsInvalidPricingJSON(t *testing.T) {
	values := completePricingOptionValues()
	values["ModelRatio"] = "{"

	if _, err := buildCompletionRatioMetaValue(values); err == nil {
		t.Fatal("expected invalid pricing JSON to fail")
	}
}

func TestAtomicPricingOptionsCannotUseGenericOptionPath(t *testing.T) {
	for _, key := range atomicModelPricingOptionKeys {
		if _, exists := atomicModelPricingOptionKeySet[key]; !exists {
			t.Fatalf("atomic pricing option %q is not protected", key)
		}
	}
}

func TestNormalizeOptionValueAcceptsExplicitScalarTypes(t *testing.T) {
	tests := []struct {
		name string
		raw  string
		want string
	}{
		{name: "string", raw: `"configured"`, want: "configured"},
		{name: "boolean", raw: `true`, want: "true"},
		{name: "integer", raw: `42`, want: "42"},
		{name: "decimal", raw: `1.25`, want: "1.25"},
		{name: "exponent", raw: `1e3`, want: "1e3"},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			got, err := normalizeOptionValue(json.RawMessage(test.raw))
			if err != nil {
				t.Fatalf("normalize option value failed: %v", err)
			}
			if got != test.want {
				t.Fatalf("normalized value = %q, want %q", got, test.want)
			}
		})
	}
}

func TestNormalizeOptionValueRejectsNonScalarTypes(t *testing.T) {
	for _, raw := range []string{"", "null", "{}", "[]"} {
		t.Run(raw, func(t *testing.T) {
			if _, err := normalizeOptionValue(json.RawMessage(raw)); err == nil {
				t.Fatalf("expected %q to fail", raw)
			}
		})
	}
}
