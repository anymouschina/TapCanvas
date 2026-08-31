package logger

import (
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/setting/operation_setting"
	"github.com/stretchr/testify/assert"
)

func TestFormatQuotaUsesCNYAsMonetaryBase(t *testing.T) {
	originalQuotaPerUnit := common.QuotaPerUnit
	originalGeneralSetting := *operation_setting.GetGeneralSetting()
	t.Cleanup(func() {
		common.QuotaPerUnit = originalQuotaPerUnit
		*operation_setting.GetGeneralSetting() = originalGeneralSetting
	})

	common.QuotaPerUnit = 500000
	operation_setting.GetGeneralSetting().QuotaDisplayType = operation_setting.QuotaDisplayTypeCNY

	assert.Equal(t, "¥0.400000", FormatQuota(200000))
	assert.Equal(t, "¥0.400000 额度", LogQuota(200000))
}

func TestFormatQuotaConvertsCustomCurrencyFromCNY(t *testing.T) {
	originalQuotaPerUnit := common.QuotaPerUnit
	originalGeneralSetting := *operation_setting.GetGeneralSetting()
	t.Cleanup(func() {
		common.QuotaPerUnit = originalQuotaPerUnit
		*operation_setting.GetGeneralSetting() = originalGeneralSetting
	})

	common.QuotaPerUnit = 500000
	operation_setting.GetGeneralSetting().QuotaDisplayType = operation_setting.QuotaDisplayTypeCustom
	operation_setting.GetGeneralSetting().CustomCurrencySymbol = "¤"
	operation_setting.GetGeneralSetting().CustomCurrencyExchangeRate = 2

	assert.Equal(t, "¤0.800000", FormatQuota(200000))
}
