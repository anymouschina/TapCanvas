package model

import (
	"fmt"
	"math"
	"sort"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/dto"
)

// ChannelImagePrice is an explicit channel quote. The ordinary model quote
// remains the shared catalog price for callers that have not selected a channel.
type ChannelImagePrice struct {
	ChannelID    int           `json:"channel_id"`
	ModelPrice   float64       `json:"model_price"`
	ParamPricing *ParamPricing `json:"param_pricing"`
}

func channelImagePricingConfig(settings dto.ChannelSettings, modelName string) (*ModelPricingConfig, bool, error) {
	raw, configured := settings.ImagePricingOverrides[modelName]
	if !configured {
		return nil, false, nil
	}
	config, err := ParseModelPricingConfig(string(raw))
	if err != nil {
		return nil, true, err
	}
	if config == nil || config.BillingMode != PricingBillingModeFixedBySpec {
		return nil, true, fmt.Errorf("image_pricing_overrides[%q] requires fixed_by_spec", modelName)
	}
	for _, spec := range config.Specs {
		if spec.DurationSeconds != 0 {
			return nil, true, fmt.Errorf("image pricing cannot contain video durations")
		}
	}
	return config, true, nil
}

// ChannelImageRequestPriceCNY resolves before submission. A configured but
// invalid/missing specification is an error, never a return to the shared price.
func ChannelImageRequestPriceCNY(settings dto.ChannelSettings, modelName, resolution, quality string, referenceCount int) (float64, bool, error) {
	if cost, configured := settings.ImageCostPerImageCNY[modelName]; configured {
		if err := validateChannelImageCost(settings, modelName, cost); err != nil {
			return 0, true, err
		}
		return cost * settings.ImageSaleMultiplier, true, nil
	}
	config, configured, err := channelImagePricingConfig(settings, modelName)
	if err != nil || !configured {
		return 0, configured, err
	}
	price, ok := fixedImageSpecPriceCNY(*config, modelName, resolution, quality)
	if !ok {
		return 0, true, fmt.Errorf("channel image price missing for %s/%s/%s", modelName, resolution, quality)
	}
	if referenceCount < 0 {
		return 0, true, fmt.Errorf("reference count must be nonnegative")
	}
	billableReferences := referenceCount - config.ReferenceImageFreeCount
	if billableReferences < 0 {
		billableReferences = 0
	}
	return price + float64(billableReferences)*config.ReferenceImagePriceCNY, true, nil
}

func channelImagePricesByModel(abilities []AbilityWithChannel) (map[string][]ChannelImagePrice, error) {
	out := make(map[string][]ChannelImagePrice)
	seen := make(map[string]bool)
	for _, ability := range abilities {
		key := fmt.Sprintf("%d/%s", ability.ChannelId, ability.Model)
		if seen[key] {
			continue
		}
		seen[key] = true
		var settings dto.ChannelSettings
		if ability.ChannelSetting != "" {
			if err := common.UnmarshalJsonStr(ability.ChannelSetting, &settings); err != nil {
				return nil, err
			}
		}
		config, configured, err := channelImagePricingConfig(settings, ability.Model)
		if cost, ok := settings.ImageCostPerImageCNY[ability.Model]; ok {
			if err := validateChannelImageCost(settings, ability.Model, cost); err != nil {
				return nil, err
			}
			canonical := CanonicalModelKey(ability.Model)
			out[canonical] = append(out[canonical], ChannelImagePrice{ChannelID: ability.ChannelId, ModelPrice: cost * settings.ImageSaleMultiplier})
			continue
		}
		if err != nil {
			return nil, fmt.Errorf("channel %d: %w", ability.ChannelId, err)
		}
		if !configured {
			continue
		}
		base, _ := config.BasePriceCNY()
		quote := Pricing{ModelPrice: base, QuotaType: 1, ParamPricing: buildConfiguredParamPricing(*config, nil)}
		applyChannelPricingContractToPricing(&quote, settings.GetPriceRatio(), 0)
		canonical := CanonicalModelKey(ability.Model)
		out[canonical] = append(out[canonical], ChannelImagePrice{ChannelID: ability.ChannelId, ModelPrice: quote.ModelPrice, ParamPricing: quote.ParamPricing})
	}
	for name := range out {
		sort.Slice(out[name], func(i, j int) bool { return out[name][i].ChannelID < out[name][j].ChannelID })
	}
	return out, nil
}

func validateChannelImageCost(settings dto.ChannelSettings, name string, cost float64) error {
	if cost <= 0 || math.IsNaN(cost) || math.IsInf(cost, 0) || settings.ImageSaleMultiplier <= 0 || math.IsNaN(settings.ImageSaleMultiplier) || math.IsInf(settings.ImageSaleMultiplier, 0) {
		return fmt.Errorf("image cost and sale multiplier must be finite positive numbers")
	}
	if _, ok := settings.ImagePricingOverrides[name]; ok {
		return fmt.Errorf("image cost contract conflicts with image_pricing_overrides for %s", name)
	}
	if settings.GetPriceRatio() != 1 {
		return fmt.Errorf("image cost contract cannot also use price_ratio")
	}
	if settings.ImageBillingUnit == "request" {
		return fmt.Errorf("per-image procurement must bill delivered images")
	}
	return nil
}
