package operation_setting

import (
	"testing"

	"github.com/stretchr/testify/assert"
)

func TestLegacyUsdDisplayIsNormalizedToCny(t *testing.T) {
	original := *GetGeneralSetting()
	t.Cleanup(func() {
		*GetGeneralSetting() = original
	})

	GetGeneralSetting().QuotaDisplayType = "USD"

	assert.Equal(t, QuotaDisplayTypeCNY, GetQuotaDisplayType())
	assert.True(t, IsCurrencyDisplay())
	assert.True(t, IsCNYDisplay())
	assert.Equal(t, "¥", GetCurrencySymbol())
}

func TestEmptyDisplayTypeDefaultsToCny(t *testing.T) {
	assert.Equal(t, QuotaDisplayTypeCNY, NormalizeQuotaDisplayType(""))
}
