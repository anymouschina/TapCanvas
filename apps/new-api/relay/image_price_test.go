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
