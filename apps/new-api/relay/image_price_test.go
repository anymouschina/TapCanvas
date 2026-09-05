package relay

import (
	"encoding/json"
	"math"
	"testing"

	"github.com/QuantumNous/new-api/dto"
)

func TestEffectiveFixedImageRequestPriceAddsReferenceImageSurcharge(t *testing.T) {
	t.Parallel()

	request := &dto.ImageRequest{
		Quality: "medium",
		Extra: map[string]json.RawMessage{
			"resolution": json.RawMessage(`"2K"`),
			"images":     json.RawMessage(`["https://example.com/a.png","https://example.com/b.png"]`),
		},
	}
	price, ok := effectiveFixedImageRequestPriceCNY("gpt-image-2", request)
	if !ok || math.Abs(price-1.4) > 1e-9 {
		t.Fatalf("request price = %v, %v; want 1.4, true", price, ok)
	}
}

func TestChargeableImageReferenceCountAppliesFreeAllowance(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name  string
		total int
		free  int
		want  int
	}{
		{name: "below allowance", total: 2, free: 3, want: 0},
		{name: "at allowance", total: 3, free: 3, want: 0},
		{name: "above allowance", total: 5, free: 3, want: 2},
		{name: "no allowance", total: 2, free: 0, want: 2},
	}
	for _, test := range tests {
		test := test
		t.Run(test.name, func(t *testing.T) {
			t.Parallel()
			if got := chargeableImageReferenceCount(test.total, test.free); got != test.want {
				t.Fatalf("chargeableImageReferenceCount(%d, %d) = %d, want %d", test.total, test.free, got, test.want)
			}
		})
	}
}
