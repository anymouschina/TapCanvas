package common

import (
	"testing"

	"github.com/stretchr/testify/assert"
)

func TestQuotaToCNYAmountUsesTheInternalPriceUnitDirectly(t *testing.T) {
	originalQuotaPerUnit := QuotaPerUnit
	t.Cleanup(func() {
		QuotaPerUnit = originalQuotaPerUnit
	})

	QuotaPerUnit = 500000

	assert.InDelta(t, 0.4, QuotaToCNYAmount(200000), 1e-12)
}
