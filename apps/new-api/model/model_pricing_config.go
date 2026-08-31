package model

import (
	"fmt"
	"math"
	"strings"

	"github.com/QuantumNous/new-api/common"
)

const (
	PricingCurrencyCNY             = "CNY"
	PricingBillingModeDisabled     = "disabled"
	PricingBillingModeFixedBySpec  = "fixed_by_spec"
	PricingBillingModeLinearBySpec = "linear_by_duration_and_resolution"
	SpecPricingSourceNone          = "none"
	SpecPricingSourceModel         = "model"
	SpecPricingSourceSystemDefault = "system_default"
	SpecPricingSourceDisabled      = "disabled"
)

// ModelPricingConfig is persisted with a model instead of being compiled into
// the gateway. Prices are always final selling prices in CNY.
type ModelPricingConfig struct {
	Currency                string             `json:"currency"`
	BillingMode             string             `json:"billing_mode"`
	ReferenceImageFreeCount int                `json:"reference_image_free_count,omitempty"`
	ReferenceImagePriceCNY  float64            `json:"reference_image_price_cny,omitempty"`
	Specs                   []ModelPricingSpec `json:"specs"`
}

// ModelPricingSpec is a fixed price or a per-second rate, depending on
// ModelPricingConfig.BillingMode. Fixed image rows have DurationSeconds = 0.
type ModelPricingSpec struct {
	SpecKey         string  `json:"spec_key,omitempty"`
	Resolution      string  `json:"resolution"`
	DurationSeconds int     `json:"duration_seconds,omitempty"`
	PriceCNY        float64 `json:"price_cny,omitempty"`
	CNYPerSecond    float64 `json:"cny_per_second,omitempty"`
}

func ParseModelPricingConfig(raw string) (*ModelPricingConfig, error) {
	trimmed := strings.TrimSpace(raw)
	if trimmed == "" {
		return nil, nil
	}
	var config ModelPricingConfig
	if err := common.Unmarshal([]byte(trimmed), &config); err != nil {
		return nil, fmt.Errorf("pricing_config 必须是合法 JSON：%w", err)
	}
	if err := config.Validate(); err != nil {
		return nil, err
	}
	return &config, nil
}

func (config ModelPricingConfig) Validate() error {
	if config.Currency != PricingCurrencyCNY {
		return fmt.Errorf("pricing_config.currency 必须为 %s", PricingCurrencyCNY)
	}
	if config.BillingMode == PricingBillingModeDisabled {
		if config.ReferenceImageFreeCount != 0 || config.ReferenceImagePriceCNY != 0 {
			return fmt.Errorf("停用规格定价时参考图计费配置必须为 0")
		}
		if config.Specs == nil || len(config.Specs) != 0 {
			return fmt.Errorf("停用规格定价时 pricing_config.specs 必须是空数组")
		}
		return nil
	}
	if config.BillingMode != PricingBillingModeFixedBySpec && config.BillingMode != PricingBillingModeLinearBySpec {
		return fmt.Errorf(
			"pricing_config.billing_mode 必须为 %q、%q 或 %q",
			PricingBillingModeDisabled,
			PricingBillingModeFixedBySpec,
			PricingBillingModeLinearBySpec,
		)
	}
	if len(config.Specs) == 0 {
		return fmt.Errorf("pricing_config.specs 不能为空")
	}
	if config.ReferenceImagePriceCNY < 0 || math.IsInf(config.ReferenceImagePriceCNY, 0) || math.IsNaN(config.ReferenceImagePriceCNY) {
		return fmt.Errorf("pricing_config.reference_image_price_cny 必须为有限非负数")
	}
	if config.ReferenceImageFreeCount < 0 {
		return fmt.Errorf("pricing_config.reference_image_free_count 必须为非负整数")
	}
	if config.ReferenceImagePriceCNY > 0 && config.BillingMode != PricingBillingModeFixedBySpec {
		return fmt.Errorf("reference_image_price_cny 仅支持 fixed_by_spec")
	}
	seen := make(map[string]struct{}, len(config.Specs))
	for index, spec := range config.Specs {
		resolution := strings.ToLower(strings.TrimSpace(spec.Resolution))
		if resolution == "" {
			return fmt.Errorf("pricing_config.specs[%d].resolution 不能为空", index)
		}
		if spec.DurationSeconds < 0 {
			return fmt.Errorf("pricing_config.specs[%d].duration_seconds 不能小于 0", index)
		}
		key := resolution + ":" + fmt.Sprint(spec.DurationSeconds)
		if config.BillingMode == PricingBillingModeFixedBySpec {
			if specKey := strings.ToLower(strings.TrimSpace(spec.SpecKey)); specKey != "" {
				// Fixed image pricing may have multiple rows for one resolution
				// (for example low / medium / high). In that contract spec_key is
				// the unique identity; resolution alone is intentionally repeated.
				key = "spec:" + specKey
			}
		}
		if _, exists := seen[key]; exists {
			return fmt.Errorf("pricing_config 中存在重复规格 %s", key)
		}
		seen[key] = struct{}{}
		if config.BillingMode == PricingBillingModeFixedBySpec {
			if !isPositiveFinite(spec.PriceCNY) || spec.CNYPerSecond != 0 {
				return fmt.Errorf("pricing_config.specs[%d] 的 fixed_by_spec 必须仅设置正数 price_cny", index)
			}
			continue
		}
		if !isPositiveFinite(spec.CNYPerSecond) || spec.PriceCNY != 0 || spec.DurationSeconds != 0 {
			return fmt.Errorf("pricing_config.specs[%d] 的 linear_by_duration_and_resolution 必须仅设置正数 cny_per_second，且 duration_seconds 为 0", index)
		}
	}
	return nil
}

func DisabledModelPricingConfig() ModelPricingConfig {
	return ModelPricingConfig{
		Currency:    PricingCurrencyCNY,
		BillingMode: PricingBillingModeDisabled,
		Specs:       make([]ModelPricingSpec, 0),
	}
}

func (config ModelPricingConfig) IsDisabled() bool {
	return config.BillingMode == PricingBillingModeDisabled
}

func isPositiveFinite(value float64) bool {
	return value > 0 && !math.IsInf(value, 0) && !math.IsNaN(value)
}

// BasePriceCNY returns the lowest fixed per-request spec price. Linear
// CNY/second rules have no duration-independent request price.
func (config ModelPricingConfig) BasePriceCNY() (float64, bool) {
	if config.BillingMode != PricingBillingModeFixedBySpec {
		return 0, false
	}
	minPrice := math.Inf(1)
	for _, spec := range config.Specs {
		if spec.PriceCNY < minPrice {
			minPrice = spec.PriceCNY
		}
	}
	if math.IsInf(minPrice, 1) {
		return 0, false
	}
	return minPrice, true
}

func (config ModelPricingConfig) FixedPriceCNY(resolution string, durationSeconds int) (float64, bool) {
	if config.BillingMode != PricingBillingModeFixedBySpec {
		return 0, false
	}
	for _, spec := range config.Specs {
		if strings.EqualFold(strings.TrimSpace(spec.Resolution), strings.TrimSpace(resolution)) && spec.DurationSeconds == durationSeconds {
			return spec.PriceCNY, true
		}
	}
	return 0, false
}

// FixedPriceCNYBySpecKey resolves a fixed row by its full public billing key.
// It is required for image matrices whose price varies by quality as well as
// resolution, where a resolution-only lookup would be ambiguous.
func (config ModelPricingConfig) FixedPriceCNYBySpecKey(specKey string) (float64, bool) {
	if config.BillingMode != PricingBillingModeFixedBySpec {
		return 0, false
	}
	normalized := strings.TrimSpace(specKey)
	if normalized == "" {
		return 0, false
	}
	for _, spec := range config.Specs {
		if strings.EqualFold(strings.TrimSpace(spec.SpecKey), normalized) {
			return spec.PriceCNY, true
		}
	}
	return 0, false
}

func (config ModelPricingConfig) LinearPriceCNY(resolution string, durationSeconds int) (float64, bool) {
	if config.BillingMode != PricingBillingModeLinearBySpec || durationSeconds <= 0 {
		return 0, false
	}
	for _, spec := range config.Specs {
		if strings.EqualFold(strings.TrimSpace(spec.Resolution), strings.TrimSpace(resolution)) {
			return spec.CNYPerSecond * float64(durationSeconds), true
		}
	}
	return 0, false
}
