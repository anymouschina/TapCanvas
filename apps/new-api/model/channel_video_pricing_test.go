package model

import (
	"encoding/json"
	"math"
	"testing"

	"github.com/QuantumNous/new-api/dto"
)

func TestChannelVideoProcurementCostAndMarkup(t *testing.T) {
	settings := dto.ChannelSettings{VideoSaleMultiplier: 2, VideoCostPricing: map[string]json.RawMessage{"example": json.RawMessage(`{"currency":"CNY","billing_mode":"linear_by_duration_and_resolution","specs":[{"resolution":"720p","cny_per_second":2.6775}]}`)}}
	price, ok, err := ChannelVideoRequestPriceCNY(settings, "example", "720p", 8)
	if err != nil || !ok || math.Abs(price-42.84) > 1e-9 {
		t.Fatalf("incorrect CNY quote %v %v %v", price, ok, err)
	}
	if _, ok, err := ChannelVideoRequestPriceCNY(settings, "example", "1080p", 8); !ok || err == nil {
		t.Fatal("missing spec must not fall back")
	}
	if _, ok, err := ChannelVideoRequestPriceCNY(settings, "another-channel-model", "720p", 8); ok || err != nil {
		t.Fatal("override leaked to another model")
	}
	settings.VideoSaleMultiplier = 0
	if _, _, err := ChannelVideoRequestPriceCNY(settings, "example", "720p", 8); err == nil {
		t.Fatal("invalid multiplier accepted")
	}
}
