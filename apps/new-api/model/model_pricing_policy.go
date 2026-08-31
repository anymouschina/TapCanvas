package model

import (
	"fmt"
	"math"
	"strings"
	"sync"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/setting/ratio_setting"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

const (
	ModelPricingModeUnconfigured = "unconfigured"
	ModelPricingModePerToken     = "per_token"
	ModelPricingModePerRequest   = "per_request"
	FixedPriceCurrencyUSD        = "USD"
	FixedPriceCurrencyCNY        = "CNY"

	modelRatioBasePriceUSDPerMillion = 2.0
)

var modelPricingPolicyMutex sync.Mutex

var modelPricingOptionKeys = []string{
	"ModelPrice",
	"ModelRatio",
	"CompletionRatio",
	"CacheRatio",
	"CreateCacheRatio",
	"ImageRatio",
	"AudioRatio",
	"AudioCompletionRatio",
}

type ModelPricingRatios struct {
	ModelRatio           *float64 `json:"model_ratio,omitempty"`
	CompletionRatio      *float64 `json:"completion_ratio,omitempty"`
	CacheRatio           *float64 `json:"cache_ratio,omitempty"`
	CreateCacheRatio     *float64 `json:"create_cache_ratio,omitempty"`
	ImageRatio           *float64 `json:"image_ratio,omitempty"`
	AudioRatio           *float64 `json:"audio_ratio,omitempty"`
	AudioCompletionRatio *float64 `json:"audio_completion_ratio,omitempty"`
}

// ModelPricingPolicy is the human-facing pricing contract. Token prices use
// USD per one million tokens. Fixed request prices carry an explicit currency:
// image/video ModelPrice values use CNY in this fork, while other kinds use
// USD. Media spec prices remain final CNY selling prices.
type ModelPricingPolicy struct {
	ModelID                       int                 `json:"model_id"`
	ModelName                     string              `json:"model_name"`
	BillingMode                   string              `json:"billing_mode"`
	FixedPrice                    *float64            `json:"fixed_price,omitempty"`
	FixedPriceCurrency            string              `json:"fixed_price_currency"`
	InputPriceUSDPerMillion       *float64            `json:"input_price_usd_per_million,omitempty"`
	OutputPriceUSDPerMillion      *float64            `json:"output_price_usd_per_million,omitempty"`
	CacheReadPriceUSDPerMillion   *float64            `json:"cache_read_price_usd_per_million,omitempty"`
	CacheWritePriceUSDPerMillion  *float64            `json:"cache_write_price_usd_per_million,omitempty"`
	ImageInputPriceUSDPerMillion  *float64            `json:"image_input_price_usd_per_million,omitempty"`
	AudioInputPriceUSDPerMillion  *float64            `json:"audio_input_price_usd_per_million,omitempty"`
	AudioOutputPriceUSDPerMillion *float64            `json:"audio_output_price_usd_per_million,omitempty"`
	CompletionRatioLocked         bool                `json:"completion_ratio_locked"`
	LockedCompletionRatio         *float64            `json:"locked_completion_ratio,omitempty"`
	HasConflictingBasePricing     bool                `json:"has_conflicting_base_pricing"`
	Ratios                        ModelPricingRatios  `json:"ratios"`
	SpecPricing                   *ModelPricingConfig `json:"spec_pricing"`
	SpecPricingSource             string              `json:"spec_pricing_source"`
}

// ModelPricingPolicyUpdate is a full replacement. Optional derived token
// prices are removed when nil; nil spec_pricing persists an explicit disabled
// marker so a system-default media rule cannot silently reactivate.
type ModelPricingPolicyUpdate struct {
	BillingMode                   string
	FixedPrice                    *float64
	FixedPriceCurrency            *string
	InputPriceUSDPerMillion       *float64
	OutputPriceUSDPerMillion      *float64
	CacheReadPriceUSDPerMillion   *float64
	CacheWritePriceUSDPerMillion  *float64
	ImageInputPriceUSDPerMillion  *float64
	AudioInputPriceUSDPerMillion  *float64
	AudioOutputPriceUSDPerMillion *float64
	SpecPricing                   *ModelPricingConfig
}

type modelPricingOptionMaps map[string]map[string]float64

type modelPricingUpdateColumns struct {
	PricingConfig string
	UpdatedTime   int64
}

func float64Pointer(value float64) *float64 {
	return &value
}

func optionalMapValue(values map[string]float64, modelName string) *float64 {
	value, exists := values[modelName]
	if !exists {
		return nil
	}
	return float64Pointer(value)
}

func loadModelPricingOptionMaps() modelPricingOptionMaps {
	return modelPricingOptionMaps{
		"ModelPrice":           ratio_setting.GetModelPriceCopy(),
		"ModelRatio":           ratio_setting.GetModelRatioCopy(),
		"CompletionRatio":      ratio_setting.GetCompletionRatioCopy(),
		"CacheRatio":           ratio_setting.GetCacheRatioCopy(),
		"CreateCacheRatio":     ratio_setting.GetCreateCacheRatioCopy(),
		"ImageRatio":           ratio_setting.GetImageRatioCopy(),
		"AudioRatio":           ratio_setting.GetAudioRatioCopy(),
		"AudioCompletionRatio": ratio_setting.GetAudioCompletionRatioCopy(),
	}
}

func validatePricingNumber(field string, value *float64, required bool) error {
	if value == nil {
		if required {
			return fmt.Errorf("%s 不能为空", field)
		}
		return nil
	}
	if math.IsNaN(*value) || math.IsInf(*value, 0) || *value < 0 {
		return fmt.Errorf("%s 必须是非负有限数字", field)
	}
	if required && *value == 0 {
		return fmt.Errorf("%s 必须大于 0", field)
	}
	return nil
}

func validateModelPricingPolicyUpdate(update ModelPricingPolicyUpdate) error {
	if update.SpecPricing != nil {
		if err := update.SpecPricing.Validate(); err != nil {
			return err
		}
	}
	switch update.BillingMode {
	case ModelPricingModeUnconfigured:
		baseFields := map[string]*float64{
			"fixed_price":                        update.FixedPrice,
			"input_price_usd_per_million":        update.InputPriceUSDPerMillion,
			"output_price_usd_per_million":       update.OutputPriceUSDPerMillion,
			"cache_read_price_usd_per_million":   update.CacheReadPriceUSDPerMillion,
			"cache_write_price_usd_per_million":  update.CacheWritePriceUSDPerMillion,
			"image_input_price_usd_per_million":  update.ImageInputPriceUSDPerMillion,
			"audio_input_price_usd_per_million":  update.AudioInputPriceUSDPerMillion,
			"audio_output_price_usd_per_million": update.AudioOutputPriceUSDPerMillion,
		}
		for field, value := range baseFields {
			if value != nil {
				return fmt.Errorf("未配置基础定价时不能设置 %s", field)
			}
		}
		if update.FixedPriceCurrency != nil {
			return fmt.Errorf("未配置基础定价时不能设置 fixed_price_currency")
		}
	case ModelPricingModePerRequest:
		if err := validatePricingNumber("fixed_price", update.FixedPrice, true); err != nil {
			return err
		}
		if update.FixedPriceCurrency == nil {
			return fmt.Errorf("fixed_price_currency 不能为空")
		}
		if *update.FixedPriceCurrency != FixedPriceCurrencyUSD && *update.FixedPriceCurrency != FixedPriceCurrencyCNY {
			return fmt.Errorf("fixed_price_currency 必须是 %q 或 %q", FixedPriceCurrencyUSD, FixedPriceCurrencyCNY)
		}
		tokenFields := map[string]*float64{
			"input_price_usd_per_million":        update.InputPriceUSDPerMillion,
			"output_price_usd_per_million":       update.OutputPriceUSDPerMillion,
			"cache_read_price_usd_per_million":   update.CacheReadPriceUSDPerMillion,
			"cache_write_price_usd_per_million":  update.CacheWritePriceUSDPerMillion,
			"image_input_price_usd_per_million":  update.ImageInputPriceUSDPerMillion,
			"audio_input_price_usd_per_million":  update.AudioInputPriceUSDPerMillion,
			"audio_output_price_usd_per_million": update.AudioOutputPriceUSDPerMillion,
		}
		for field, value := range tokenFields {
			if value != nil {
				return fmt.Errorf("按次计费不能同时设置 %s", field)
			}
		}
	case ModelPricingModePerToken:
		if update.FixedPrice != nil {
			return fmt.Errorf("按量计费不能同时设置 fixed_price")
		}
		if update.FixedPriceCurrency != nil {
			return fmt.Errorf("按量计费不能同时设置 fixed_price_currency")
		}
		if err := validatePricingNumber("input_price_usd_per_million", update.InputPriceUSDPerMillion, true); err != nil {
			return err
		}
		optionalFields := map[string]*float64{
			"output_price_usd_per_million":       update.OutputPriceUSDPerMillion,
			"cache_read_price_usd_per_million":   update.CacheReadPriceUSDPerMillion,
			"cache_write_price_usd_per_million":  update.CacheWritePriceUSDPerMillion,
			"image_input_price_usd_per_million":  update.ImageInputPriceUSDPerMillion,
			"audio_input_price_usd_per_million":  update.AudioInputPriceUSDPerMillion,
			"audio_output_price_usd_per_million": update.AudioOutputPriceUSDPerMillion,
		}
		for field, value := range optionalFields {
			if err := validatePricingNumber(field, value, false); err != nil {
				return err
			}
		}
		if update.AudioOutputPriceUSDPerMillion != nil &&
			(update.AudioInputPriceUSDPerMillion == nil || *update.AudioInputPriceUSDPerMillion == 0) {
			return fmt.Errorf("设置音频输出价格前必须设置大于 0 的音频输入价格")
		}
	default:
		return fmt.Errorf(
			"billing_mode 必须是 %q、%q 或 %q",
			ModelPricingModeUnconfigured,
			ModelPricingModePerToken,
			ModelPricingModePerRequest,
		)
	}
	return nil
}

func fixedPriceCurrencyForModel(meta Model) string {
	switch strings.ToLower(strings.TrimSpace(meta.Kind)) {
	case "image", "video":
		return FixedPriceCurrencyCNY
	default:
		return FixedPriceCurrencyUSD
	}
}

func buildModelPricingPolicy(meta Model, optionMaps modelPricingOptionMaps) (*ModelPricingPolicy, error) {
	modelName := strings.TrimSpace(meta.ModelName)
	if modelName == "" {
		return nil, fmt.Errorf("模型名称不能为空")
	}
	fixedPrice := optionalMapValue(optionMaps["ModelPrice"], modelName)
	modelRatio := optionalMapValue(optionMaps["ModelRatio"], modelName)
	completionRatio := optionalMapValue(optionMaps["CompletionRatio"], modelName)
	cacheRatio := optionalMapValue(optionMaps["CacheRatio"], modelName)
	createCacheRatio := optionalMapValue(optionMaps["CreateCacheRatio"], modelName)
	imageRatio := optionalMapValue(optionMaps["ImageRatio"], modelName)
	audioRatio := optionalMapValue(optionMaps["AudioRatio"], modelName)
	audioCompletionRatio := optionalMapValue(optionMaps["AudioCompletionRatio"], modelName)
	completionInfo := ratio_setting.GetCompletionRatioInfo(modelName)

	policy := &ModelPricingPolicy{
		ModelID:                   meta.Id,
		ModelName:                 modelName,
		BillingMode:               ModelPricingModeUnconfigured,
		FixedPrice:                fixedPrice,
		FixedPriceCurrency:        fixedPriceCurrencyForModel(meta),
		CompletionRatioLocked:     completionInfo.Locked,
		HasConflictingBasePricing: fixedPrice != nil && modelRatio != nil,
		Ratios: ModelPricingRatios{
			ModelRatio:           modelRatio,
			CompletionRatio:      completionRatio,
			CacheRatio:           cacheRatio,
			CreateCacheRatio:     createCacheRatio,
			ImageRatio:           imageRatio,
			AudioRatio:           audioRatio,
			AudioCompletionRatio: audioCompletionRatio,
		},
	}
	if completionInfo.Locked {
		policy.LockedCompletionRatio = float64Pointer(completionInfo.Ratio)
	}
	if fixedPrice != nil {
		policy.BillingMode = ModelPricingModePerRequest
	} else if modelRatio != nil {
		policy.BillingMode = ModelPricingModePerToken
	}
	if modelRatio != nil {
		inputPrice := *modelRatio * modelRatioBasePriceUSDPerMillion
		policy.InputPriceUSDPerMillion = float64Pointer(inputPrice)
		effectiveCompletionRatio := completionRatio
		if completionInfo.Locked {
			effectiveCompletionRatio = float64Pointer(completionInfo.Ratio)
		}
		if effectiveCompletionRatio != nil {
			policy.OutputPriceUSDPerMillion = float64Pointer(inputPrice * *effectiveCompletionRatio)
		}
		if cacheRatio != nil {
			policy.CacheReadPriceUSDPerMillion = float64Pointer(inputPrice * *cacheRatio)
		}
		if createCacheRatio != nil {
			policy.CacheWritePriceUSDPerMillion = float64Pointer(inputPrice * *createCacheRatio)
		}
		if imageRatio != nil {
			policy.ImageInputPriceUSDPerMillion = float64Pointer(inputPrice * *imageRatio)
		}
		if audioRatio != nil {
			audioInputPrice := inputPrice * *audioRatio
			policy.AudioInputPriceUSDPerMillion = float64Pointer(audioInputPrice)
			if audioCompletionRatio != nil {
				policy.AudioOutputPriceUSDPerMillion = float64Pointer(audioInputPrice * *audioCompletionRatio)
			}
		}
	}
	specPricing, specPricingSource, err := resolveEffectiveModelPricingConfig(
		modelName,
		meta.PricingConfig,
	)
	if err != nil {
		return nil, err
	}
	policy.SpecPricing = specPricing
	policy.SpecPricingSource = specPricingSource
	return policy, nil
}

func GetModelPricingPolicy(modelID int) (*ModelPricingPolicy, error) {
	if modelID <= 0 {
		return nil, fmt.Errorf("模型 ID 必须是正整数")
	}
	var meta Model
	if err := DB.First(&meta, modelID).Error; err != nil {
		return nil, err
	}
	if meta.NameRule != NameRuleExact {
		return nil, fmt.Errorf("规则模型不能直接配置定价，请编辑具体模型")
	}
	return buildModelPricingPolicy(meta, loadModelPricingOptionMaps())
}

func clearModelPricingOptionValues(optionMaps modelPricingOptionMaps, modelName string) {
	for _, key := range modelPricingOptionKeys {
		delete(optionMaps[key], modelName)
	}
}

func applyModelPricingPolicyToMaps(optionMaps modelPricingOptionMaps, modelName string, update ModelPricingPolicyUpdate) {
	clearModelPricingOptionValues(optionMaps, modelName)
	if update.BillingMode == ModelPricingModeUnconfigured {
		return
	}
	if update.BillingMode == ModelPricingModePerRequest {
		optionMaps["ModelPrice"][modelName] = *update.FixedPrice
		return
	}

	inputPrice := *update.InputPriceUSDPerMillion
	optionMaps["ModelRatio"][modelName] = inputPrice / modelRatioBasePriceUSDPerMillion
	if update.OutputPriceUSDPerMillion != nil {
		optionMaps["CompletionRatio"][modelName] = *update.OutputPriceUSDPerMillion / inputPrice
	}
	if update.CacheReadPriceUSDPerMillion != nil {
		optionMaps["CacheRatio"][modelName] = *update.CacheReadPriceUSDPerMillion / inputPrice
	}
	if update.CacheWritePriceUSDPerMillion != nil {
		optionMaps["CreateCacheRatio"][modelName] = *update.CacheWritePriceUSDPerMillion / inputPrice
	}
	if update.ImageInputPriceUSDPerMillion != nil {
		optionMaps["ImageRatio"][modelName] = *update.ImageInputPriceUSDPerMillion / inputPrice
	}
	if update.AudioInputPriceUSDPerMillion != nil {
		audioInputPrice := *update.AudioInputPriceUSDPerMillion
		optionMaps["AudioRatio"][modelName] = audioInputPrice / inputPrice
		if update.AudioOutputPriceUSDPerMillion != nil {
			optionMaps["AudioCompletionRatio"][modelName] = *update.AudioOutputPriceUSDPerMillion / audioInputPrice
		}
	}
}

func validateModelPricingOptionMaps(optionMaps modelPricingOptionMaps) error {
	if len(optionMaps) != len(modelPricingOptionKeys) {
		return fmt.Errorf("定价选项必须完整包含 %d 个键", len(modelPricingOptionKeys))
	}
	for _, key := range modelPricingOptionKeys {
		values, exists := optionMaps[key]
		if !exists || values == nil {
			return fmt.Errorf("缺少定价选项 %s", key)
		}
		for modelName, value := range values {
			if strings.TrimSpace(modelName) == "" {
				return fmt.Errorf("%s 不能包含空模型名", key)
			}
			if math.IsNaN(value) || math.IsInf(value, 0) || value < 0 {
				return fmt.Errorf("%s[%q] 必须是非负有限数字", key, modelName)
			}
		}
	}
	return nil
}

func persistModelPricingOptionMaps(tx *gorm.DB, optionMaps modelPricingOptionMaps) (map[string]string, error) {
	serialized := make(map[string]string, len(modelPricingOptionKeys))
	for _, key := range modelPricingOptionKeys {
		rawValue, err := common.Marshal(optionMaps[key])
		if err != nil {
			return nil, fmt.Errorf("序列化 %s 失败: %w", key, err)
		}
		value := string(rawValue)
		serialized[key] = value
		option := Option{Key: key, Value: value}
		if err := tx.Clauses(clause.OnConflict{
			Columns:   []clause.Column{{Name: "key"}},
			DoUpdates: clause.AssignmentColumns([]string{"value"}),
		}).Create(&option).Error; err != nil {
			return nil, fmt.Errorf("保存 %s 失败: %w", key, err)
		}
	}
	return serialized, nil
}

func applyModelPricingOptionMaps(serialized map[string]string) error {
	for _, key := range modelPricingOptionKeys {
		if err := updateOptionMap(key, serialized[key]); err != nil {
			return fmt.Errorf("数据库已保存，但刷新 %s 运行时配置失败: %w", key, err)
		}
	}
	return nil
}

func replaceModelPricingOptionMapsLocked(optionMaps modelPricingOptionMaps) error {
	var serialized map[string]string
	if err := DB.Transaction(func(tx *gorm.DB) error {
		var err error
		serialized, err = persistModelPricingOptionMaps(tx, optionMaps)
		return err
	}); err != nil {
		return err
	}
	return applyModelPricingOptionMaps(serialized)
}

// ReplaceModelPricingOptionMaps is the single atomic write endpoint used by
// the bulk visual pricing editor.
func ReplaceModelPricingOptionMaps(optionMaps map[string]map[string]float64) error {
	typedMaps := modelPricingOptionMaps(optionMaps)
	if err := validateModelPricingOptionMaps(typedMaps); err != nil {
		return err
	}

	modelPricingPolicyMutex.Lock()
	defer modelPricingPolicyMutex.Unlock()

	return replaceModelPricingOptionMapsLocked(typedMaps)
}

// ResetModelRatioToDefault changes the default ratio map through the same
// eight-map transaction used by every other pricing write. This keeps the
// historical reset action without reopening a single-option write path.
func ResetModelRatioToDefault(rawDefaultModelRatio string) error {
	var defaultModelRatio map[string]float64
	if err := common.Unmarshal([]byte(rawDefaultModelRatio), &defaultModelRatio); err != nil {
		return fmt.Errorf("默认 ModelRatio 不是合法 JSON: %w", err)
	}
	if defaultModelRatio == nil {
		return fmt.Errorf("默认 ModelRatio 必须是 JSON 对象")
	}

	modelPricingPolicyMutex.Lock()
	defer modelPricingPolicyMutex.Unlock()

	optionMaps := loadModelPricingOptionMaps()
	optionMaps["ModelRatio"] = defaultModelRatio
	for modelName := range defaultModelRatio {
		delete(optionMaps["ModelPrice"], modelName)
	}
	if err := validateModelPricingOptionMaps(optionMaps); err != nil {
		return err
	}
	return replaceModelPricingOptionMapsLocked(optionMaps)
}

func UpdateModelPricingPolicy(modelID int, update ModelPricingPolicyUpdate) (*ModelPricingPolicy, error) {
	if modelID <= 0 {
		return nil, fmt.Errorf("模型 ID 必须是正整数")
	}
	if err := validateModelPricingPolicyUpdate(update); err != nil {
		return nil, err
	}

	modelPricingPolicyMutex.Lock()
	defer modelPricingPolicyMutex.Unlock()

	optionMaps := loadModelPricingOptionMaps()
	var updatedModel Model
	var serialized map[string]string
	err := DB.Transaction(func(tx *gorm.DB) error {
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).First(&updatedModel, modelID).Error; err != nil {
			return err
		}
		if updatedModel.NameRule != NameRuleExact {
			return fmt.Errorf("规则模型不能直接配置定价，请编辑具体模型")
		}
		modelName := strings.TrimSpace(updatedModel.ModelName)
		if modelName == "" {
			return fmt.Errorf("模型名称不能为空")
		}
		if update.BillingMode == ModelPricingModePerRequest {
			expectedCurrency := fixedPriceCurrencyForModel(updatedModel)
			if update.FixedPriceCurrency == nil || *update.FixedPriceCurrency != expectedCurrency {
				actualCurrency := "<missing>"
				if update.FixedPriceCurrency != nil {
					actualCurrency = *update.FixedPriceCurrency
				}
				return fmt.Errorf(
					"模型 %s 的基础按次价格币种必须是 %s，收到 %s",
					modelName,
					expectedCurrency,
					actualCurrency,
				)
			}
		}
		completionInfo := ratio_setting.GetCompletionRatioInfo(modelName)
		if completionInfo.Locked && update.OutputPriceUSDPerMillion != nil {
			expectedOutputPrice := *update.InputPriceUSDPerMillion * completionInfo.Ratio
			if math.Abs(*update.OutputPriceUSDPerMillion-expectedOutputPrice) > 1e-9 {
				return fmt.Errorf("模型 %s 的补全倍率由后端固定为 %g，不能单独修改输出价格", modelName, completionInfo.Ratio)
			}
			update.OutputPriceUSDPerMillion = nil
		}
		applyModelPricingPolicyToMaps(optionMaps, modelName, update)

		specPricing := update.SpecPricing
		if specPricing == nil {
			disabledConfig := DisabledModelPricingConfig()
			specPricing = &disabledConfig
		}
		rawPricingConfig, err := common.Marshal(specPricing)
		if err != nil {
			return fmt.Errorf("序列化规格定价失败: %w", err)
		}
		pricingConfig := string(rawPricingConfig)
		if err := tx.Model(&Model{}).
			Where("id = ?", updatedModel.Id).
			Select("pricing_config", "updated_time").
			Updates(modelPricingUpdateColumns{
				PricingConfig: pricingConfig,
				UpdatedTime:   common.GetTimestamp(),
			}).Error; err != nil {
			return fmt.Errorf("保存模型规格定价失败: %w", err)
		}
		updatedModel.PricingConfig = pricingConfig
		serialized, err = persistModelPricingOptionMaps(tx, optionMaps)
		return err
	})
	if err != nil {
		return nil, err
	}
	if err := applyModelPricingOptionMaps(serialized); err != nil {
		return nil, err
	}
	return buildModelPricingPolicy(updatedModel, optionMaps)
}
