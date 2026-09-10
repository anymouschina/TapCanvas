package model

import (
	"fmt"
	"math"
	"sort"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/dto"
)

type ChannelVideoPrice struct {
	ChannelID     int                `json:"channel_id"`
	ParamPricing  *ParamPricing      `json:"param_pricing"`
	PricingConfig ModelPricingConfig `json:"pricing_config"`
}

func channelVideoCostConfig(settings dto.ChannelSettings, name string) (*ModelPricingConfig, bool, error) {
	raw, ok := settings.VideoCostPricing[name]
	if !ok {
		return nil, false, nil
	}
	if settings.VideoSaleMultiplier <= 0 || math.IsNaN(settings.VideoSaleMultiplier) || math.IsInf(settings.VideoSaleMultiplier, 0) {
		return nil, true, fmt.Errorf("video_sale_multiplier must be positive")
	}
	config, err := ParseModelPricingConfig(string(raw))
	if err != nil {
		return nil, true, err
	}
	if config == nil || config.BillingMode != PricingBillingModeLinearBySpec {
		return nil, true, fmt.Errorf("video_cost_pricing[%q] requires linear_by_duration_and_resolution", name)
	}
	if settings.GetPriceRatio() != 1 || settings.GetMinVideoPriceCNYPerSecond() != 0 {
		return nil, true, fmt.Errorf("video procurement pricing cannot also use price_ratio or a video price floor")
	}
	return config, true, nil
}

// Publish a specification price that covers every enabled channel, matching
// the shared catalog contract. Per-channel quotes remain available separately.
func applyChannelVideoQuotes(pricing *Pricing, quotes []ChannelVideoPrice) {
	if len(quotes) == 0 {
		return
	}
	results := make(map[string]ParamPricingResult)
	if pricing.ParamPricing != nil {
		for _, r := range pricing.ParamPricing.Results {
			results[r.SpecKey] = r
		}
	}
	for _, q := range quotes {
		if q.ParamPricing != nil {
			for _, r := range q.ParamPricing.Results {
				if old, ok := results[r.SpecKey]; !ok || r.PriceCNY > old.PriceCNY {
					results[r.SpecKey] = r
				}
			}
		}
	}
	if len(results) == 0 {
		return
	}
	merged := make([]ParamPricingResult, 0, len(results))
	for _, r := range results {
		merged = append(merged, r)
	}
	sort.Slice(merged, func(i, j int) bool { return merged[i].SpecKey < merged[j].SpecKey })
	pricing.ParamPricing = &ParamPricing{Currency: PricingCurrencyCNY, BillingMode: PricingBillingModeFixedBySpec, Formula: "maximum enabled channel retail quote per specification", Results: merged}
	pricing.QuotaType = 1
}

func ChannelVideoRequestPriceCNY(settings dto.ChannelSettings, name, resolution string, seconds int) (float64, bool, error) {
	config, configured, err := channelVideoCostConfig(settings, name)
	if err != nil || !configured {
		return 0, configured, err
	}
	price, ok := config.LinearPriceCNY(resolution, seconds)
	if !ok {
		return 0, true, fmt.Errorf("channel video cost missing for %s/%s/%ds", name, resolution, seconds)
	}
	return price * settings.VideoSaleMultiplier, true, nil
}

func channelVideoPricesByModel(abilities []AbilityWithChannel) (map[string][]ChannelVideoPrice, error) {
	out := make(map[string][]ChannelVideoPrice)
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
		config, configured, err := channelVideoCostConfig(settings, a.Model)
		if err != nil {
			return nil, err
		}
		if !configured {
			continue
		}
		for i := range config.Specs {
			config.Specs[i].CNYPerSecond *= settings.VideoSaleMultiplier
		}
		var meta Model
		if err := DB.Where("model_name = ?", a.Model).First(&meta).Error; err != nil {
			return nil, err
		}
		if params, ok := settings.VideoModelParams[a.Model]; ok {
			meta.ParamsDef = string(params)
		}
		canonical := CanonicalModelKey(a.Model)
		out[canonical] = append(out[canonical], ChannelVideoPrice{ChannelID: a.ChannelId, ParamPricing: buildConfiguredParamPricing(*config, &meta), PricingConfig: *config})
	}
	for k := range out {
		sort.Slice(out[k], func(i, j int) bool { return out[k][i].ChannelID < out[k][j].ChannelID })
	}
	return out, nil
}
