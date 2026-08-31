package ratio_setting

import (
	"testing"

	"github.com/stretchr/testify/assert"
)

func TestDefaultDeepSeekV4PricingUsesOffPeakCostWithTenPercentMarkup(t *testing.T) {
	t.Parallel()

	const cnyPerModelRatio = 2.0 * USD2RMB

	assert.InDelta(t, 1.65/cnyPerModelRatio, defaultModelRatio["deepseek-v4-flash"], 1e-15)
	assert.InDelta(t, 4.95/cnyPerModelRatio, defaultModelRatio["deepseek-v4-pro"], 1e-15)
	assert.InDelta(t, 3.0, defaultCompletionRatio["deepseek-v4-flash"], 1e-15)
	assert.InDelta(t, 3.0, defaultCompletionRatio["deepseek-v4-pro"], 1e-15)

	flashInput := defaultModelRatio["deepseek-v4-flash"] * cnyPerModelRatio
	proInput := defaultModelRatio["deepseek-v4-pro"] * cnyPerModelRatio
	assert.InDelta(t, 1.65, flashInput, 1e-12)
	assert.InDelta(t, 4.95, flashInput*defaultCompletionRatio["deepseek-v4-flash"], 1e-12)
	assert.InDelta(t, 0.055, flashInput*defaultCacheRatio["deepseek-v4-flash"], 1e-12)
	assert.InDelta(t, 4.95, proInput, 1e-12)
	assert.InDelta(t, 14.85, proInput*defaultCompletionRatio["deepseek-v4-pro"], 1e-12)
	assert.InDelta(t, 0.165, proInput*defaultCacheRatio["deepseek-v4-pro"], 1e-12)
}
