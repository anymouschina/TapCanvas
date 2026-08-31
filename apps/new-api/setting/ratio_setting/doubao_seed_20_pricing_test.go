package ratio_setting

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestDefaultDoubaoSeed20PricingUsesOfficialCNYWithTenPercentMarkup(t *testing.T) {
	t.Parallel()

	const cnyPerModelRatio = 2.0 * USD2RMB
	tests := []struct {
		model               string
		inputCNYPerMillion  float64
		outputCNYPerMillion float64
	}{
		{model: "doubao-seed-2-0-pro-260428", inputCNYPerMillion: 3.52, outputCNYPerMillion: 17.6},
		{model: "doubao-seed-2-0-lite-260428", inputCNYPerMillion: 0.66, outputCNYPerMillion: 3.96},
		{model: "doubao-seed-2-0-mini-260428", inputCNYPerMillion: 0.22, outputCNYPerMillion: 2.2},
	}

	for _, test := range tests {
		test := test
		t.Run(test.model, func(t *testing.T) {
			t.Parallel()

			inputPrice := defaultModelRatio[test.model] * cnyPerModelRatio
			assert.InDelta(t, test.inputCNYPerMillion, inputPrice, 1e-12)
			assert.InDelta(t, test.outputCNYPerMillion, inputPrice*defaultCompletionRatio[test.model], 1e-12)
			assert.InDelta(t, test.inputCNYPerMillion*0.2, inputPrice*defaultCacheRatio[test.model], 1e-12)
			assert.Zero(t, defaultCreateCacheRatio[test.model])
		})
	}
}

func TestResolveDoubaoSeed20ModelRatioForOfficialPromptTokenTiers(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name         string
		model        string
		promptTokens int
		wantRatio    float64
	}{
		{name: "pro 32K inclusive", model: "doubao-seed-2-0-pro-260428", promptTokens: 32_000, wantRatio: 1},
		{name: "pro middle tier", model: "doubao-seed-2-0-pro-260428", promptTokens: 32_001, wantRatio: 1.5},
		{name: "pro 128K inclusive", model: "doubao-seed-2-0-pro-260428", promptTokens: 128_000, wantRatio: 1.5},
		{name: "pro upper tier", model: "doubao-seed-2-0-pro-260428", promptTokens: 128_001, wantRatio: 3},
		{name: "lite upper tier", model: "doubao-seed-2-0-lite-260428", promptTokens: 200_000, wantRatio: 3},
		{name: "mini middle tier", model: "doubao-seed-2-0-mini-260428", promptTokens: 64_000, wantRatio: 2},
		{name: "mini upper tier", model: "doubao-seed-2.0-mini", promptTokens: 200_000, wantRatio: 4},
	}

	for _, test := range tests {
		test := test
		t.Run(test.name, func(t *testing.T) {
			t.Parallel()

			ratio, tiered := ResolveModelRatioForPromptTokens(test.model, 1, test.promptTokens)
			require.True(t, tiered)
			assert.InDelta(t, test.wantRatio, ratio, 1e-15)
		})
	}
}

func TestResolveModelRatioForPromptTokensLeavesUntieredModelsUnchanged(t *testing.T) {
	t.Parallel()

	ratio, tiered := ResolveModelRatioForPromptTokens("gpt-4.1", 0.5, 200_000)
	assert.False(t, tiered)
	assert.Equal(t, 0.5, ratio)
}
