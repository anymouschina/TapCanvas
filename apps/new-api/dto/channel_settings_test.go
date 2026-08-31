package dto

import "testing"

func TestResolvePricingModelName(t *testing.T) {
	settings := ChannelSettings{PricingModelMapping: map[string]string{
		"kling-v3-funai": "kling-v3",
	}}

	resolved, err := settings.ResolvePricingModelName("kling-v3-funai")
	if err != nil || resolved != "kling-v3" {
		t.Fatalf("resolved = %q, err = %v; want kling-v3", resolved, err)
	}
	resolved, err = settings.ResolvePricingModelName("kling-v3")
	if err != nil || resolved != "kling-v3" {
		t.Fatalf("identity resolved = %q, err = %v", resolved, err)
	}
}

func TestResolvePricingModelNameRejectsInvalidReferences(t *testing.T) {
	tests := []ChannelSettings{
		{PricingModelMapping: map[string]string{"kling-v3-funai": ""}},
		{PricingModelMapping: map[string]string{
			"kling-v3-funai":    "kling-v3-discount",
			"kling-v3-discount": "kling-v3",
		}},
	}
	for _, settings := range tests {
		if _, err := settings.ResolvePricingModelName("kling-v3-funai"); err == nil {
			t.Fatal("expected invalid pricing mapping to fail")
		}
	}
}

func TestVideoPriceFloorNormalization(t *testing.T) {
	if got := (ChannelSettings{}).GetMinVideoPriceCNYPerSecond(); got != 0 {
		t.Fatalf("unset floor = %v, want 0", got)
	}
	if got := (ChannelSettings{MinVideoPriceCNYPerSecond: 0.3}).GetMinVideoPriceCNYPerSecond(); got != 0.3 {
		t.Fatalf("configured floor = %v, want 0.3", got)
	}
}
