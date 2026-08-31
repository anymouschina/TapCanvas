package ratio_setting

// promptTokenTier describes a supplier price tier selected by the total input
// token count of one request. MaxPromptTokens is inclusive; zero means no upper
// bound. Multiplier is applied to the model's configurable [0,32]K base ratio.
type promptTokenTier struct {
	MaxPromptTokens int
	Multiplier      float64
}

var doubaoSeed20ProAndLiteTiers = []promptTokenTier{
	{MaxPromptTokens: 32_000, Multiplier: 1},
	{MaxPromptTokens: 128_000, Multiplier: 1.5},
	{MaxPromptTokens: 0, Multiplier: 3},
}

var doubaoSeed20MiniTiers = []promptTokenTier{
	{MaxPromptTokens: 32_000, Multiplier: 1},
	{MaxPromptTokens: 128_000, Multiplier: 2},
	{MaxPromptTokens: 0, Multiplier: 4},
}

var promptTokenTiersByModel = map[string][]promptTokenTier{
	"doubao-seed-2-0-pro-260428":  doubaoSeed20ProAndLiteTiers,
	"doubao-seed-2.0-pro":         doubaoSeed20ProAndLiteTiers,
	"doubao-seed-2-0-lite-260428": doubaoSeed20ProAndLiteTiers,
	"doubao-seed-2-0-lite-260215": doubaoSeed20ProAndLiteTiers,
	"doubao-seed-2.0-lite":        doubaoSeed20ProAndLiteTiers,
	"doubao-seed-2-0-mini-260428": doubaoSeed20MiniTiers,
	"doubao-seed-2.0-mini":        doubaoSeed20MiniTiers,
}

// ResolveModelRatioForPromptTokens applies a deterministic supplier price tier
// to a configurable base model ratio. The bool reports whether the model has a
// token-tier contract; callers can keep their existing ratio when it is false.
func ResolveModelRatioForPromptTokens(modelName string, baseModelRatio float64, promptTokens int) (float64, bool) {
	tiers, ok := promptTokenTiersByModel[FormatMatchingModelName(modelName)]
	if !ok {
		return baseModelRatio, false
	}

	for _, tier := range tiers {
		if tier.MaxPromptTokens == 0 || promptTokens <= tier.MaxPromptTokens {
			return baseModelRatio * tier.Multiplier, true
		}
	}

	return baseModelRatio, false
}
