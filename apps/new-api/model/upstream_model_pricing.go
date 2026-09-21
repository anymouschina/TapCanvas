package model

import (
	"errors"
	"fmt"
	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/setting/ratio_setting"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
	"math"
	"strings"
)

// Source prices and markup are persisted separately from effective billing maps.
// Re-sync always derives from the fresh source, never from the previous sale price.
type UpstreamModelPricing struct {
	ChannelID  int                 `json:"channel_id"`
	Version    string              `json:"version"`
	Multiplier float64             `json:"selling_multiplier"`
	Price      Pricing             `json:"price"`
	Spec       *ModelPricingConfig `json:"spec_pricing"`
}

const upstreamPricingPrefix = "UpstreamModelPricing:"

func loadUpstreamModelPricing(db *gorm.DB, name string) (*UpstreamModelPricing, error) {
	var option Option
	err := db.Where("key = ?", upstreamPricingPrefix+name).First(&option).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	var source UpstreamModelPricing
	if err := common.Unmarshal([]byte(option.Value), &source); err != nil {
		return nil, fmt.Errorf("invalid upstream pricing for %s: %w", name, err)
	}
	if err := validatePricingNumber("selling_multiplier", &source.Multiplier, true); err != nil {
		return nil, err
	}
	return &source, nil
}

func saveUpstreamModelPricing(tx *gorm.DB, name string, source UpstreamModelPricing) error {
	raw, err := common.Marshal(source)
	if err != nil {
		return err
	}
	return tx.Clauses(clause.OnConflict{Columns: []clause.Column{{Name: "key"}}, DoUpdates: clause.AssignmentColumns([]string{"value"})}).Create(&Option{Key: upstreamPricingPrefix + name, Value: string(raw)}).Error
}

func applyUpstreamSellingPrice(maps modelPricingOptionMaps, name string, source UpstreamModelPricing) (string, error) {
	if err := validatePricingNumber("selling_multiplier", &source.Multiplier, true); err != nil {
		return "", err
	}
	clearModelPricingOptionValues(maps, name)
	price := source.Price
	switch price.QuotaType {
	case 1:
		maps["ModelPrice"][name] = price.ModelPrice * source.Multiplier
	case 0:
		completion := ratio_setting.GetCompletionRatioInfo(name)
		if completion.Locked && math.Abs(completion.Ratio-price.CompletionRatio) > 1e-9 {
			return "", fmt.Errorf("upstream completion ratio for %s conflicts with locked billing ratio", name)
		}
		maps["ModelRatio"][name] = price.ModelRatio * source.Multiplier
		maps["CompletionRatio"][name] = price.CompletionRatio
	default:
		return "", fmt.Errorf("invalid quota type for %s", name)
	}
	for key, value := range map[string]*float64{"CacheRatio": price.CacheRatio, "CreateCacheRatio": price.CreateCacheRatio, "ImageRatio": price.ImageRatio, "AudioRatio": price.AudioRatio, "AudioCompletionRatio": price.AudioCompletionRatio} {
		if value != nil {
			maps[key][name] = *value
		}
	}
	for key, values := range maps {
		if value, ok := values[name]; ok {
			if err := validatePricingNumber(key, &value, false); err != nil {
				return "", err
			}
		}
	}
	config := DisabledModelPricingConfig()
	if source.Spec != nil {
		config = *source.Spec
		config.Specs = append([]ModelPricingSpec{}, source.Spec.Specs...)
		config.ReferenceImagePriceCNY *= source.Multiplier
		for i := range config.Specs {
			config.Specs[i].PriceCNY *= source.Multiplier
			config.Specs[i].CNYPerSecond *= source.Multiplier
		}
	}
	if err := config.Validate(); err != nil {
		return "", err
	}
	raw, err := common.Marshal(config)
	return string(raw), err
}

func updateUpstreamSellingMultiplier(id int, multiplier float64) (*ModelPricingPolicy, error) {
	if err := validatePricingNumber("selling_multiplier", &multiplier, true); err != nil {
		return nil, err
	}
	modelPricingPolicyMutex.Lock()
	defer modelPricingPolicyMutex.Unlock()
	maps := loadModelPricingOptionMaps()
	var serialized map[string]string
	var meta Model
	var source *UpstreamModelPricing
	err := DB.Transaction(func(tx *gorm.DB) error {
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).First(&meta, id).Error; err != nil {
			return err
		}
		var err error
		source, err = loadUpstreamModelPricing(tx, meta.ModelName)
		if err != nil {
			return err
		}
		if source == nil {
			return fmt.Errorf("模型尚未同步上游价格，不能设置上游售价倍率")
		}
		source.Multiplier = multiplier
		meta.PricingConfig, err = applyUpstreamSellingPrice(maps, meta.ModelName, *source)
		if err != nil {
			return err
		}
		if err := tx.Model(&meta).Select("pricing_config", "updated_time").Updates(modelPricingUpdateColumns{PricingConfig: meta.PricingConfig, UpdatedTime: common.GetTimestamp()}).Error; err != nil {
			return err
		}
		if err := saveUpstreamModelPricing(tx, meta.ModelName, *source); err != nil {
			return err
		}
		serialized, err = persistModelPricingOptionMaps(tx, maps)
		return err
	})
	if err != nil {
		return nil, err
	}
	if err := applyModelPricingOptionMaps(serialized); err != nil {
		return nil, err
	}
	policy, err := buildModelPricingPolicy(meta, maps)
	if err != nil {
		return nil, err
	}
	policy.Upstream = source
	return policy, nil
}

// Import published prices (including upstream channel adjustments), not raw
// catalog pricing_config, which can differ from what the upstream charges.
func upstreamPublishedSpec(price Pricing) (*ModelPricingConfig, error) {
	p := price.ParamPricing
	if p == nil {
		return nil, nil
	}
	config := ModelPricingConfig{Currency: p.Currency, BillingMode: p.BillingMode, ReferenceImageFreeCount: p.ReferenceImageFreeCount, ReferenceImagePriceCNY: p.ReferenceImagePriceCNY, Specs: []ModelPricingSpec{}}
	rates := make(map[string]float64)
	for _, row := range p.Results {
		spec := ModelPricingSpec{SpecKey: row.SpecKey, Resolution: row.Resolution, DurationSeconds: row.DurationSeconds, PriceCNY: row.PriceCNY}
		if p.BillingMode == PricingBillingModeLinearBySpec {
			if row.DurationSeconds <= 0 {
				return nil, fmt.Errorf("linear upstream price requires positive duration")
			}
			rate := row.PriceCNY / float64(row.DurationSeconds)
			if previous, ok := rates[row.Resolution]; ok {
				if math.Abs(previous-rate) > 1e-9 {
					return nil, fmt.Errorf("inconsistent upstream linear price for %s", row.Resolution)
				}
				continue
			}
			rates[row.Resolution] = rate
			spec = ModelPricingSpec{Resolution: row.Resolution, CNYPerSecond: rate}
		}
		config.Specs = append(config.Specs, spec)
	}
	if err := config.Validate(); err != nil {
		return nil, err
	}
	return &config, nil
}

// Bulk editors may retain synced prices, but cannot replace a derived sale
// price independently of its saved source and multiplier.
func validateUpstreamPricingOptionReplacement(tx *gorm.DB, maps modelPricingOptionMaps) error {
	var options []Option
	if err := tx.Where("key LIKE ?", upstreamPricingPrefix+"%").Find(&options).Error; err != nil {
		return err
	}
	for _, option := range options {
		name := strings.TrimPrefix(option.Key, upstreamPricingPrefix)
		var count int64
		if err := tx.Model(&Model{}).Where("model_name = ? AND status = ?", name, 1).Count(&count).Error; err != nil {
			return err
		}
		if count == 0 {
			continue
		}
		source, err := loadUpstreamModelPricing(tx, name)
		if err != nil {
			return err
		}
		expected := modelPricingOptionMaps{}
		for _, key := range modelPricingOptionKeys {
			expected[key] = map[string]float64{}
		}
		if _, err := applyUpstreamSellingPrice(expected, name, *source); err != nil {
			return err
		}
		for _, key := range modelPricingOptionKeys {
			want, exists := expected[key][name]
			got, present := maps[key][name]
			if exists != present || want != got {
				return fmt.Errorf("模型 %s 由上游同步定价，请在模型中修改售价倍率", name)
			}
		}
	}
	return nil
}
