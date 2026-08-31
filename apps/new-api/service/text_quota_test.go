package service

import (
	"net/http/httptest"
	"testing"
	"time"

	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/dto"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	"github.com/QuantumNous/new-api/types"

	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/require"
)

func TestCalculateTextQuotaSummaryUnifiedForClaudeSemantic(t *testing.T) {
	gin.SetMode(gin.TestMode)
	w := httptest.NewRecorder()
	ctx, _ := gin.CreateTestContext(w)

	usage := &dto.Usage{
		PromptTokens:     1000,
		CompletionTokens: 200,
		PromptTokensDetails: dto.InputTokenDetails{
			CachedTokens:         100,
			CachedCreationTokens: 50,
		},
		ClaudeCacheCreation5mTokens: 10,
		ClaudeCacheCreation1hTokens: 20,
	}

	priceData := types.PriceData{
		ModelRatio:           1,
		CompletionRatio:      2,
		CacheRatio:           0.1,
		CacheCreationRatio:   1.25,
		CacheCreation5mRatio: 1.25,
		CacheCreation1hRatio: 2,
		GroupRatioInfo: types.GroupRatioInfo{
			GroupRatio: 1,
		},
	}

	chatRelayInfo := &relaycommon.RelayInfo{
		RelayFormat:             types.RelayFormatOpenAI,
		FinalRequestRelayFormat: types.RelayFormatClaude,
		OriginModelName:         "claude-3-7-sonnet",
		PriceData:               priceData,
		StartTime:               time.Now(),
	}
	messageRelayInfo := &relaycommon.RelayInfo{
		RelayFormat:             types.RelayFormatClaude,
		FinalRequestRelayFormat: types.RelayFormatClaude,
		OriginModelName:         "claude-3-7-sonnet",
		PriceData:               priceData,
		StartTime:               time.Now(),
	}

	chatSummary := calculateTextQuotaSummary(ctx, chatRelayInfo, usage)
	messageSummary := calculateTextQuotaSummary(ctx, messageRelayInfo, usage)

	require.Equal(t, messageSummary.Quota, chatSummary.Quota)
	require.Equal(t, messageSummary.CacheCreationTokens5m, chatSummary.CacheCreationTokens5m)
	require.Equal(t, messageSummary.CacheCreationTokens1h, chatSummary.CacheCreationTokens1h)
	require.True(t, chatSummary.IsClaudeUsageSemantic)
	require.Equal(t, 1488, chatSummary.Quota)
}

func TestCalculateTextQuotaSummaryUsesSplitClaudeCacheCreationRatios(t *testing.T) {
	gin.SetMode(gin.TestMode)
	w := httptest.NewRecorder()
	ctx, _ := gin.CreateTestContext(w)

	relayInfo := &relaycommon.RelayInfo{
		RelayFormat:             types.RelayFormatOpenAI,
		FinalRequestRelayFormat: types.RelayFormatClaude,
		OriginModelName:         "claude-3-7-sonnet",
		PriceData: types.PriceData{
			ModelRatio:           1,
			CompletionRatio:      1,
			CacheRatio:           0,
			CacheCreationRatio:   1,
			CacheCreation5mRatio: 2,
			CacheCreation1hRatio: 3,
			GroupRatioInfo: types.GroupRatioInfo{
				GroupRatio: 1,
			},
		},
		StartTime: time.Now(),
	}

	usage := &dto.Usage{
		PromptTokens:     100,
		CompletionTokens: 0,
		PromptTokensDetails: dto.InputTokenDetails{
			CachedCreationTokens: 10,
		},
		ClaudeCacheCreation5mTokens: 2,
		ClaudeCacheCreation1hTokens: 3,
	}

	summary := calculateTextQuotaSummary(ctx, relayInfo, usage)

	// 100 + remaining(5)*1 + 2*2 + 3*3 = 118
	require.Equal(t, 118, summary.Quota)
}

func TestCalculateTextQuotaSummaryUsesAnthropicUsageSemanticFromUpstreamUsage(t *testing.T) {
	gin.SetMode(gin.TestMode)
	w := httptest.NewRecorder()
	ctx, _ := gin.CreateTestContext(w)

	relayInfo := &relaycommon.RelayInfo{
		RelayFormat:     types.RelayFormatOpenAI,
		OriginModelName: "claude-3-7-sonnet",
		PriceData: types.PriceData{
			ModelRatio:           1,
			CompletionRatio:      2,
			CacheRatio:           0.1,
			CacheCreationRatio:   1.25,
			CacheCreation5mRatio: 1.25,
			CacheCreation1hRatio: 2,
			GroupRatioInfo: types.GroupRatioInfo{
				GroupRatio: 1,
			},
		},
		StartTime: time.Now(),
	}

	usage := &dto.Usage{
		PromptTokens:     1000,
		CompletionTokens: 200,
		UsageSemantic:    "anthropic",
		PromptTokensDetails: dto.InputTokenDetails{
			CachedTokens:         100,
			CachedCreationTokens: 50,
		},
		ClaudeCacheCreation5mTokens: 10,
		ClaudeCacheCreation1hTokens: 20,
	}

	summary := calculateTextQuotaSummary(ctx, relayInfo, usage)

	require.True(t, summary.IsClaudeUsageSemantic)
	require.Equal(t, "anthropic", summary.UsageSemantic)
	require.Equal(t, 1488, summary.Quota)
}

func TestCacheWriteTokensTotal(t *testing.T) {
	t.Run("split cache creation", func(t *testing.T) {
		summary := textQuotaSummary{
			CacheCreationTokens:   50,
			CacheCreationTokens5m: 10,
			CacheCreationTokens1h: 20,
		}
		require.Equal(t, 50, cacheWriteTokensTotal(summary))
	})

	t.Run("legacy cache creation", func(t *testing.T) {
		summary := textQuotaSummary{CacheCreationTokens: 50}
		require.Equal(t, 50, cacheWriteTokensTotal(summary))
	})

	t.Run("split cache creation without aggregate remainder", func(t *testing.T) {
		summary := textQuotaSummary{
			CacheCreationTokens5m: 10,
			CacheCreationTokens1h: 20,
		}
		require.Equal(t, 30, cacheWriteTokensTotal(summary))
	})
}

func TestCalculateTextQuotaSummaryHandlesLegacyClaudeDerivedOpenAIUsage(t *testing.T) {
	gin.SetMode(gin.TestMode)
	w := httptest.NewRecorder()
	ctx, _ := gin.CreateTestContext(w)

	relayInfo := &relaycommon.RelayInfo{
		RelayFormat:     types.RelayFormatOpenAI,
		OriginModelName: "claude-3-7-sonnet",
		PriceData: types.PriceData{
			ModelRatio:           1,
			CompletionRatio:      5,
			CacheRatio:           0.1,
			CacheCreationRatio:   1.25,
			CacheCreation5mRatio: 1.25,
			CacheCreation1hRatio: 2,
			GroupRatioInfo:       types.GroupRatioInfo{GroupRatio: 1},
		},
		StartTime: time.Now(),
	}

	usage := &dto.Usage{
		PromptTokens:     62,
		CompletionTokens: 95,
		PromptTokensDetails: dto.InputTokenDetails{
			CachedTokens: 3544,
		},
		ClaudeCacheCreation5mTokens: 586,
	}

	summary := calculateTextQuotaSummary(ctx, relayInfo, usage)

	// 62 + 3544*0.1 + 586*1.25 + 95*5 = 1624.9 => 1624
	require.Equal(t, 1624, summary.Quota)
}

func TestCalculateTextQuotaSummarySeparatesOpenRouterCacheReadFromPromptBilling(t *testing.T) {
	gin.SetMode(gin.TestMode)
	w := httptest.NewRecorder()
	ctx, _ := gin.CreateTestContext(w)

	relayInfo := &relaycommon.RelayInfo{
		OriginModelName: "openai/gpt-4.1",
		ChannelMeta: &relaycommon.ChannelMeta{
			ChannelType: constant.ChannelTypeCustom,
			ProtocolID:  constant.ProtocolOpenRouter,
		},
		PriceData: types.PriceData{
			ModelRatio:         1,
			CompletionRatio:    1,
			CacheRatio:         0.1,
			CacheCreationRatio: 1.25,
			GroupRatioInfo:     types.GroupRatioInfo{GroupRatio: 1},
		},
		StartTime: time.Now(),
	}

	usage := &dto.Usage{
		PromptTokens:     2604,
		CompletionTokens: 383,
		PromptTokensDetails: dto.InputTokenDetails{
			CachedTokens: 2432,
		},
	}

	summary := calculateTextQuotaSummary(ctx, relayInfo, usage)

	// OpenRouter OpenAI-format display keeps prompt_tokens as total input,
	// but billing still separates normal input from cache read tokens.
	// quota = (2604 - 2432) + 2432*0.1 + 383 = 798.2 => 798
	require.Equal(t, 2604, summary.PromptTokens)
	require.Equal(t, 798, summary.Quota)
}

func TestCalculateTextQuotaSummarySeparatesOpenRouterCacheCreationFromPromptBilling(t *testing.T) {
	gin.SetMode(gin.TestMode)
	w := httptest.NewRecorder()
	ctx, _ := gin.CreateTestContext(w)

	relayInfo := &relaycommon.RelayInfo{
		OriginModelName: "openai/gpt-4.1",
		ChannelMeta: &relaycommon.ChannelMeta{
			ChannelType: constant.ChannelTypeCustom,
			ProtocolID:  constant.ProtocolOpenRouter,
		},
		PriceData: types.PriceData{
			ModelRatio:         1,
			CompletionRatio:    1,
			CacheCreationRatio: 1.25,
			GroupRatioInfo:     types.GroupRatioInfo{GroupRatio: 1},
		},
		StartTime: time.Now(),
	}

	usage := &dto.Usage{
		PromptTokens:     2604,
		CompletionTokens: 383,
		PromptTokensDetails: dto.InputTokenDetails{
			CachedCreationTokens: 100,
		},
	}

	summary := calculateTextQuotaSummary(ctx, relayInfo, usage)

	// prompt_tokens is still logged as total input, but cache creation is billed separately.
	// quota = (2604 - 100) + 100*1.25 + 383 = 3012
	require.Equal(t, 2604, summary.PromptTokens)
	require.Equal(t, 3012, summary.Quota)
}

func TestCalculateTextQuotaSummaryAppliesUserDiscountTokenBased(t *testing.T) {
	gin.SetMode(gin.TestMode)
	w := httptest.NewRecorder()
	ctx, _ := gin.CreateTestContext(w)

	// 基础 token 计费夹具（UsePrice=false）：无缓存、无附加费。
	// 未打折 Q = (1000 + 200*2) * (1*1) = 1400。
	basePrice := types.PriceData{
		ModelRatio:      1,
		CompletionRatio: 2,
		GroupRatioInfo:  types.GroupRatioInfo{GroupRatio: 1},
	}
	usage := &dto.Usage{
		PromptTokens:     1000,
		CompletionTokens: 200,
	}

	newRelay := func(userPriceRatio float64) *relaycommon.RelayInfo {
		pd := basePrice
		pd.UserPriceRatio = userPriceRatio
		return &relaycommon.RelayInfo{
			OriginModelName: "gpt-4.1",
			PriceData:       pd,
			StartTime:       time.Now(),
		}
	}

	undiscounted := calculateTextQuotaSummary(ctx, newRelay(0), usage)
	require.Equal(t, 1400, undiscounted.Quota)

	discounted := calculateTextQuotaSummary(ctx, newRelay(0.8), usage)
	// round(1400 * 0.8) = 1120
	require.Equal(t, 1120, discounted.Quota)
	require.Equal(t, int(float64(undiscounted.Quota)*0.8), discounted.Quota)
}

func TestCalculateTextQuotaSummaryAppliesUserDiscountFixedPrice(t *testing.T) {
	gin.SetMode(gin.TestMode)
	w := httptest.NewRecorder()
	ctx, _ := gin.CreateTestContext(w)

	// 固定价夹具（UsePrice=true）：Q = ModelPrice * QuotaPerUnit * GroupRatio
	//                              = 0.001 * 500000 * 1 = 500。
	basePrice := types.PriceData{
		UsePrice:       true,
		ModelPrice:     0.001,
		GroupRatioInfo: types.GroupRatioInfo{GroupRatio: 1},
	}
	usage := &dto.Usage{
		PromptTokens:     100,
		CompletionTokens: 0,
	}

	newRelay := func(userPriceRatio float64) *relaycommon.RelayInfo {
		pd := basePrice
		pd.UserPriceRatio = userPriceRatio
		return &relaycommon.RelayInfo{
			OriginModelName: "gpt-image-1",
			PriceData:       pd,
			StartTime:       time.Now(),
		}
	}

	undiscounted := calculateTextQuotaSummary(ctx, newRelay(0), usage)
	require.Equal(t, 500, undiscounted.Quota)

	discounted := calculateTextQuotaSummary(ctx, newRelay(0.8), usage)
	// round(500 * 0.8) = 400
	require.Equal(t, 400, discounted.Quota)
	require.Equal(t, int(float64(undiscounted.Quota)*0.8), discounted.Quota)
}

func TestCalculateTextQuotaSummaryUserDiscountDefaultIsNoop(t *testing.T) {
	gin.SetMode(gin.TestMode)
	w := httptest.NewRecorder()
	ctx, _ := gin.CreateTestContext(w)

	// UserPriceRatio 为零值（未设置）时，NormalizePriceRatio 视作 1.0，结果与无折扣完全一致。
	t.Run("token based", func(t *testing.T) {
		price := types.PriceData{
			ModelRatio:      1,
			CompletionRatio: 2,
			GroupRatioInfo:  types.GroupRatioInfo{GroupRatio: 1},
			UserPriceRatio:  0, // 零值 = 不打折
		}
		relayInfo := &relaycommon.RelayInfo{
			OriginModelName: "gpt-4.1",
			PriceData:       price,
			StartTime:       time.Now(),
		}
		summary := calculateTextQuotaSummary(ctx, relayInfo, &dto.Usage{PromptTokens: 1000, CompletionTokens: 200})
		require.Equal(t, 1400, summary.Quota)
	})

	t.Run("fixed price", func(t *testing.T) {
		price := types.PriceData{
			UsePrice:       true,
			ModelPrice:     0.001,
			GroupRatioInfo: types.GroupRatioInfo{GroupRatio: 1},
			UserPriceRatio: 0, // 零值 = 不打折
		}
		relayInfo := &relaycommon.RelayInfo{
			OriginModelName: "gpt-image-1",
			PriceData:       price,
			StartTime:       time.Now(),
		}
		summary := calculateTextQuotaSummary(ctx, relayInfo, &dto.Usage{PromptTokens: 100})
		require.Equal(t, 500, summary.Quota)
	})
}

func TestCalculateTextQuotaSummaryFloorWinsAfterUserDiscount(t *testing.T) {
	gin.SetMode(gin.TestMode)
	w := httptest.NewRecorder()
	ctx, _ := gin.CreateTestContext(w)

	// 未打折 Q = 1（1 token * ratio 1）。折扣 0.3 → 0.3 → round 0，
	// 但 TotalTokens>0 且 ratio 非零，最终额度地板兜底为 1。
	price := types.PriceData{
		ModelRatio:      1,
		CompletionRatio: 1,
		GroupRatioInfo:  types.GroupRatioInfo{GroupRatio: 1},
		UserPriceRatio:  0.3,
	}
	relayInfo := &relaycommon.RelayInfo{
		OriginModelName: "gpt-4.1",
		PriceData:       price,
		StartTime:       time.Now(),
	}
	summary := calculateTextQuotaSummary(ctx, relayInfo, &dto.Usage{PromptTokens: 1, CompletionTokens: 0})
	require.Equal(t, 1, summary.Quota)
}

func TestCalculateTextQuotaSummaryKeepsPrePRClaudeOpenRouterBilling(t *testing.T) {
	gin.SetMode(gin.TestMode)
	w := httptest.NewRecorder()
	ctx, _ := gin.CreateTestContext(w)

	relayInfo := &relaycommon.RelayInfo{
		FinalRequestRelayFormat: types.RelayFormatClaude,
		OriginModelName:         "anthropic/claude-3.7-sonnet",
		ChannelMeta: &relaycommon.ChannelMeta{
			ChannelType: constant.ChannelTypeCustom,
			ProtocolID:  constant.ProtocolOpenRouter,
		},
		PriceData: types.PriceData{
			ModelRatio:         1,
			CompletionRatio:    1,
			CacheRatio:         0.1,
			CacheCreationRatio: 1.25,
			GroupRatioInfo:     types.GroupRatioInfo{GroupRatio: 1},
		},
		StartTime: time.Now(),
	}

	usage := &dto.Usage{
		PromptTokens:     2604,
		CompletionTokens: 383,
		PromptTokensDetails: dto.InputTokenDetails{
			CachedTokens: 2432,
		},
	}

	summary := calculateTextQuotaSummary(ctx, relayInfo, usage)

	// Pre-PR PostClaudeConsumeQuota behavior for OpenRouter:
	// prompt = 2604 - 2432 = 172
	// quota = 172 + 2432*0.1 + 383 = 798.2 => 798
	require.True(t, summary.IsClaudeUsageSemantic)
	require.Equal(t, 172, summary.PromptTokens)
	require.Equal(t, 798, summary.Quota)
}

func TestCalculateTextQuotaSummaryAppliesChannelPriceRatio(t *testing.T) {
	gin.SetMode(gin.TestMode)

	newRelayInfo := func() *relaycommon.RelayInfo {
		return &relaycommon.RelayInfo{
			RelayFormat:     types.RelayFormatOpenAI,
			OriginModelName: "gpt-test",
			PriceData: types.PriceData{
				ModelRatio:      1,
				CompletionRatio: 1,
				GroupRatioInfo:  types.GroupRatioInfo{GroupRatio: 1},
			},
			StartTime: time.Now(),
		}
	}
	usage := &dto.Usage{PromptTokens: 1000, CompletionTokens: 0}

	// 无渠道倍率
	ctxPlain, _ := gin.CreateTestContext(httptest.NewRecorder())
	base := calculateTextQuotaSummary(ctxPlain, newRelayInfo(), usage)
	require.Equal(t, 1000, base.Quota)

	// 渠道倍率 1.5 → 最终额度 ×1.5
	ctxRatio, _ := gin.CreateTestContext(httptest.NewRecorder())
	ctxRatio.Set(string(constant.ContextKeyChannelSetting), dto.ChannelSettings{PriceRatio: 1.5})
	scaled := calculateTextQuotaSummary(ctxRatio, newRelayInfo(), usage)
	require.Equal(t, 1500, scaled.Quota)
	require.InDelta(t, 1.5, scaled.ChannelPriceRatio, 1e-9)

	// price_ratio<=0 视为未配置
	ctxZero, _ := gin.CreateTestContext(httptest.NewRecorder())
	ctxZero.Set(string(constant.ContextKeyChannelSetting), dto.ChannelSettings{PriceRatio: 0})
	zero := calculateTextQuotaSummary(ctxZero, newRelayInfo(), usage)
	require.Equal(t, 1000, zero.Quota)
}

func TestCalculateTextQuotaSummarySettlesDoubaoUsingActualPromptTokenTier(t *testing.T) {
	gin.SetMode(gin.TestMode)
	ctx, _ := gin.CreateTestContext(httptest.NewRecorder())

	relayInfo := &relaycommon.RelayInfo{
		OriginModelName: "doubao-seed-2-0-pro-260428",
		PriceData: types.PriceData{
			BaseModelRatio:  1,
			ModelRatio:      1,
			CompletionRatio: 5,
			GroupRatioInfo:  types.GroupRatioInfo{GroupRatio: 1},
		},
		StartTime: time.Now(),
	}

	summary := calculateTextQuotaSummary(ctx, relayInfo, &dto.Usage{
		PromptTokens:     128_001,
		CompletionTokens: 0,
	})

	require.InDelta(t, 3, summary.ModelRatio, 1e-15)
	require.Equal(t, 384_003, summary.Quota)
}
