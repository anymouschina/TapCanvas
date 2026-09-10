package model

import (
	"fmt"
	"math"
	"sort"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/dto"
)

// ChannelTextPrice publishes the retail rates for one channel in CNY/M tokens.
type ChannelTextPrice struct {
	ChannelID  int     `json:"channel_id"`
	Input      float64 `json:"input"`
	Output     float64 `json:"output"`
	CacheRead  float64 `json:"cache_read"`
	CacheWrite float64 `json:"cache_write"`
}

func ChannelTextRetail(settings dto.ChannelSettings, name string) (dto.TextTokenCostCNY, bool, error) {
	cost, ok := settings.TextCostPerMillionCNY[name]
	if !ok {
		return cost, false, nil
	}
	multiplier := settings.TextSaleMultiplier
	if multiplier <= 0 || math.IsNaN(multiplier) || math.IsInf(multiplier, 0) {
		return cost, true, fmt.Errorf("text_sale_multiplier must be finite and positive")
	}
	if settings.GetPriceRatio() != 1 {
		return cost, true, fmt.Errorf("text procurement pricing cannot also use price_ratio")
	}
	if cost.Input <= 0 {
		return cost, true, fmt.Errorf("text input procurement cost must be positive")
	}
	for _, rate := range []float64{cost.Input, cost.Output, cost.CacheRead, cost.CacheWrite} {
		if rate < 0 || math.IsNaN(rate) || math.IsInf(rate, 0) || math.IsInf(rate*multiplier, 0) {
			return cost, true, fmt.Errorf("text procurement rates must be finite and nonnegative")
		}
	}
	return dto.TextTokenCostCNY{Input: cost.Input * multiplier, Output: cost.Output * multiplier,
		CacheRead: cost.CacheRead * multiplier, CacheWrite: cost.CacheWrite * multiplier}, true, nil
}

func channelTextPricesByModel(abilities []AbilityWithChannel) (map[string][]ChannelTextPrice, error) {
	out := make(map[string][]ChannelTextPrice)
	seen := make(map[string]bool)
	for _, a := range abilities {
		key := fmt.Sprintf("%d/%s", a.ChannelId, a.Model)
		if seen[key] {
			continue
		}
		seen[key] = true
		var settings dto.ChannelSettings
		if a.ChannelSetting != "" {
			if err := common.UnmarshalJsonStr(a.ChannelSetting, &settings); err != nil {
				return nil, err
			}
		}
		rate, ok, err := ChannelTextRetail(settings, a.Model)
		if err != nil {
			return nil, err
		}
		if !ok {
			continue
		}
		name := CanonicalModelKey(a.Model)
		out[name] = append(out[name], ChannelTextPrice{a.ChannelId, rate.Input, rate.Output, rate.CacheRead, rate.CacheWrite})
	}
	for name := range out {
		sort.Slice(out[name], func(i, j int) bool { return out[name][i].ChannelID < out[name][j].ChannelID })
	}
	return out, nil
}

// The shared catalog quotes enough for every enabled channel; each channel
// continues to charge its own contract.
func applyChannelTextQuotes(pricing *Pricing, quotes []ChannelTextPrice) {
	if len(quotes) == 0 {
		return
	}
	input := pricing.ModelRatio * 2
	output := input * pricing.CompletionRatio
	cache, write := input, input
	if pricing.CacheRatio != nil {
		cache = input * *pricing.CacheRatio
	}
	if pricing.CreateCacheRatio != nil {
		write = input * *pricing.CreateCacheRatio
	}
	for _, q := range quotes {
		input = math.Max(input, q.Input)
		output = math.Max(output, q.Output)
		cache = math.Max(cache, q.CacheRead)
		write = math.Max(write, q.CacheWrite)
	}
	pricing.QuotaType = 0
	pricing.ModelRatio = input / 2
	pricing.CompletionRatio = output / input
	c, w := cache/input, write/input
	pricing.CacheRatio = &c
	pricing.CreateCacheRatio = &w
}
