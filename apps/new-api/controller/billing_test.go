package controller

import (
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/setting/operation_setting"
	"github.com/stretchr/testify/assert"
)

func TestQuotaToBillingAmountUsesCNYAsMonetaryBase(t *testing.T) {
	originalQuotaPerUnit := common.QuotaPerUnit
	originalGeneralSetting := *operation_setting.GetGeneralSetting()
	t.Cleanup(func() {
		common.QuotaPerUnit = originalQuotaPerUnit
		*operation_setting.GetGeneralSetting() = originalGeneralSetting
	})

	common.QuotaPerUnit = 500000
	operation_setting.GetGeneralSetting().QuotaDisplayType = operation_setting.QuotaDisplayTypeCNY

	assert.InDelta(t, 0.4, quotaToBillingAmount(200000), 1e-12)
}

func TestQuotaToBillingAmountKeepsTokenDisplayUnchanged(t *testing.T) {
	originalGeneralSetting := *operation_setting.GetGeneralSetting()
	t.Cleanup(func() {
		*operation_setting.GetGeneralSetting() = originalGeneralSetting
	})

	operation_setting.GetGeneralSetting().QuotaDisplayType = operation_setting.QuotaDisplayTypeTokens

	assert.Equal(t, 200000.0, quotaToBillingAmount(200000))
}
