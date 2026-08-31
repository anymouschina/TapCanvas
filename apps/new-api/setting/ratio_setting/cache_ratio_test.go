package ratio_setting

import (
	"testing"

	"github.com/stretchr/testify/assert"
)

func TestDeepSeekV4DefaultCacheRatiosMatchOffPeakPricing(t *testing.T) {
	t.Parallel()

	assert.InDelta(t, 0.055/1.65, defaultCacheRatio["deepseek-v4-flash"], 1e-15)
	assert.InDelta(t, 0.165/4.95, defaultCacheRatio["deepseek-v4-pro"], 1e-15)
}
