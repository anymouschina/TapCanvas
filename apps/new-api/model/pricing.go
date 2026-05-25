package model

import (
	"encoding/json"
	"fmt"
	"math"
	"strings"

	"sync"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/setting/ratio_setting"
	"github.com/QuantumNous/new-api/types"
)

type Pricing struct {
	ModelName              string                  `json:"model_name"`
	Description            string                  `json:"description,omitempty"`
	Icon                   string                  `json:"icon,omitempty"`
	Tags                   string                  `json:"tags,omitempty"`
	VendorID               int                     `json:"vendor_id,omitempty"`
	QuotaType              int                     `json:"quota_type"`
	ModelRatio             float64                 `json:"model_ratio"`
	ModelPrice             float64                 `json:"model_price"`
	OwnerBy                string                  `json:"owner_by"`
	CompletionRatio        float64                 `json:"completion_ratio"`
	CacheRatio             *float64                `json:"cache_ratio,omitempty"`
	CreateCacheRatio       *float64                `json:"create_cache_ratio,omitempty"`
	ImageRatio             *float64                `json:"image_ratio,omitempty"`
	AudioRatio             *float64                `json:"audio_ratio,omitempty"`
	AudioCompletionRatio   *float64                `json:"audio_completion_ratio,omitempty"`
	EnableGroup            []string                `json:"enable_groups"`
	SupportedEndpointTypes []constant.EndpointType `json:"supported_endpoint_types"`
	PricingVersion         string                  `json:"pricing_version,omitempty"`
	ParamPricing           *ParamPricing           `json:"param_pricing,omitempty"`
}

type ParamPricing struct {
	Currency    string               `json:"currency"`
	BillingMode string               `json:"billing_mode"`
	Formula     string               `json:"formula,omitempty"`
	Results     []ParamPricingResult `json:"results,omitempty"`
}

type ParamPricingResult struct {
	SpecKey         string  `json:"spec_key"`
	DurationSeconds int     `json:"duration_seconds"`
	Resolution      string  `json:"resolution"`
	PriceUSD        float64 `json:"price_usd"`
	PriceCNY        float64 `json:"price_cny,omitempty"`
	PriceDisplayUSD string  `json:"price_display_usd"`
	PriceDisplayCNY string  `json:"price_display_cny,omitempty"`
}

type PricingVendor struct {
	ID          int    `json:"id"`
	Name        string `json:"name"`
	Description string `json:"description,omitempty"`
	Icon        string `json:"icon,omitempty"`
}

var (
	pricingMap           []Pricing
	vendorsList          []PricingVendor
	supportedEndpointMap map[string]common.EndpointInfo
	lastGetPricingTime   time.Time
	updatePricingLock    sync.Mutex

	// 缓存映射：模型名 -> 启用分组 / 计费类型 / kind
	modelEnableGroups     = make(map[string][]string)
	modelQuotaTypeMap     = make(map[string]int)
	modelKindMap          = make(map[string]string)
	modelEnableGroupsLock = sync.RWMutex{}
)

type linearVideoPricingRule struct {
	resolution   string
	cnyPerSecond float64
}

type fixedImagePricingRule struct {
	specKey           string
	aspectRatio       string
	resolution        string
	quality           string
	apimartCurrentUSD float64
	cnyPrice          float64 // when > 0, used directly instead of apimartCurrentUSD conversion
}

// Rates in CNY per second; credits = ceil(cnyPerSecond * durationSeconds * creditsPerCny).
// Source: APIMart official prices ($/s) × 7.3 (USD→CNY) × 1.2 (20% markup). creditsPerCny default = 10.
// 2026-05-17: All video model rates increased by 20%.
var linearVideoPricingRules = map[string][]linearVideoPricingRule{
	// legacy model IDs (260128 snapshot) — same rates as 2.0 base
	"doubao-seedance-2-0-260128": {
		{resolution: "480p", cnyPerSecond: 0.7945},
		{resolution: "720p", cnyPerSecond: 1.7100},
	},
	"doubao-seedance-2-0-fast-260128": {
		{resolution: "480p", cnyPerSecond: 0.6395},
		{resolution: "720p", cnyPerSecond: 1.3753},
	},
	// doubao-seedance-2.0 base: $0.0907/s, $0.1952/s, $0.44/s × 7.3 × 1.2
	"doubao-seedance-2.0": {
		{resolution: "480p", cnyPerSecond: 0.7945},
		{resolution: "720p", cnyPerSecond: 1.7100},
		{resolution: "1080p", cnyPerSecond: 3.8544},
	},
	"doubao-seedance-2.0-apimart": {
		{resolution: "480p", cnyPerSecond: 0.7945},
		{resolution: "720p", cnyPerSecond: 1.7100},
		{resolution: "1080p", cnyPerSecond: 3.8544},
	},
	// doubao-seedance-2.0-fast: $0.073/s, $0.157/s × 7.3 × 1.2 (no 1080p on APIMart)
	"doubao-seedance-2.0-fast": {
		{resolution: "480p", cnyPerSecond: 0.6395},
		{resolution: "720p", cnyPerSecond: 1.3753},
		{resolution: "1080p", cnyPerSecond: 1.3753},
	},
	"doubao-seedance-2.0-fast-apimart": {
		{resolution: "480p", cnyPerSecond: 0.6395},
		{resolution: "720p", cnyPerSecond: 1.3753},
		{resolution: "1080p", cnyPerSecond: 1.3753},
	},
	// doubao-seedance-2.0-face: $0.124/s, $0.267/s, $0.625/s × 7.3 × 1.2
	"doubao-seedance-2.0-face": {
		{resolution: "480p", cnyPerSecond: 1.0862},
		{resolution: "720p", cnyPerSecond: 2.3389},
		{resolution: "1080p", cnyPerSecond: 5.4750},
	},
	"doubao-seedance-2.0-face-apimart": {
		{resolution: "480p", cnyPerSecond: 1.0862},
		{resolution: "720p", cnyPerSecond: 2.3389},
		{resolution: "1080p", cnyPerSecond: 5.4750},
	},
	// doubao-seedance-2.0-fast-face: $0.1/s, $0.215/s × 7.3 × 1.2 (no 1080p)
	"doubao-seedance-2.0-fast-face": {
		{resolution: "480p", cnyPerSecond: 0.8760},
		{resolution: "720p", cnyPerSecond: 1.8834},
	},
	"doubao-seedance-2.0-fast-face-apimart": {
		{resolution: "480p", cnyPerSecond: 0.8760},
		{resolution: "720p", cnyPerSecond: 1.8834},
	},
	// wan2.7-videoedit: APIMart official prices × 7.3 × 1.2 × 1.2 (2nd 20% markup 2026-05-17)
	//   720P:  $0.083/s × 7.3 × 1.44 = 0.8725 CNY/s
	//   1080P: $0.137/s × 7.3 × 1.44 = 1.4401 CNY/s
	"wan2.7-videoedit": {
		{resolution: "720p", cnyPerSecond: 0.8725},
		{resolution: "1080p", cnyPerSecond: 1.4401},
	},
	"wan2.7-videoedit-apimart": {
		{resolution: "720p", cnyPerSecond: 0.8725},
		{resolution: "1080p", cnyPerSecond: 1.4401},
	},
	// kling-v3: APIMart official prices × 7.3 × 1.2
	// 720p $0.084, 1080p $0.112, 720p+sound $0.126, 1080p+sound $0.168, 4k/4k+sound $0.5357
	"kling-v3": {
		{resolution: "720p", cnyPerSecond: 0.7358},
		{resolution: "1080p", cnyPerSecond: 0.9811},
		{resolution: "720p+sound", cnyPerSecond: 1.1038},
		{resolution: "1080p+sound", cnyPerSecond: 1.4717},
		{resolution: "4k", cnyPerSecond: 4.6927},
		{resolution: "4k+sound", cnyPerSecond: 4.6927},
	},
	"kling-v3-apimart": {
		{resolution: "720p", cnyPerSecond: 0.7358},
		{resolution: "1080p", cnyPerSecond: 0.9811},
		{resolution: "720p+sound", cnyPerSecond: 1.1038},
		{resolution: "1080p+sound", cnyPerSecond: 1.4717},
		{resolution: "4k", cnyPerSecond: 4.6927},
		{resolution: "4k+sound", cnyPerSecond: 4.6927},
	},
	// kling-v3-omni: APIMart official prices × 7.3 × 1.5 × 1.2
	// 720p $0.084, 1080p $0.112, 720p+sound $0.112, 720p+video $0.126
	// 1080p+sound $0.14, 1080p+video $0.168, 4k/4k+sound $0.5357
	"kling-v3-omni": {
		{resolution: "720p", cnyPerSecond: 1.1038},
		{resolution: "1080p", cnyPerSecond: 1.4717},
		{resolution: "720p+sound", cnyPerSecond: 1.4717},
		{resolution: "720p+video", cnyPerSecond: 1.6556},
		{resolution: "1080p+sound", cnyPerSecond: 1.8396},
		{resolution: "1080p+video", cnyPerSecond: 2.2075},
		{resolution: "4k", cnyPerSecond: 7.0391},
		{resolution: "4k+sound", cnyPerSecond: 7.0391},
	},
	"kling-v3-omni-apimart": {
		{resolution: "720p", cnyPerSecond: 1.1038},
		{resolution: "1080p", cnyPerSecond: 1.4717},
		{resolution: "720p+sound", cnyPerSecond: 1.4717},
		{resolution: "720p+video", cnyPerSecond: 1.6556},
		{resolution: "1080p+sound", cnyPerSecond: 1.8396},
		{resolution: "1080p+video", cnyPerSecond: 2.2075},
		{resolution: "4k", cnyPerSecond: 7.0391},
		{resolution: "4k+sound", cnyPerSecond: 7.0391},
	},
	// kling motion-control: APIMart retail price × 7.3 × 1.2 (USD → CNY).
	// No resolution param upstream — `mode` (std|pro) is what differs in price.
	// We reuse the `resolution` slot to carry std/pro so spec_key follows
	// `video:{std|pro}:{duration}s` (consumed by extractKlingMotionModeFromSpecKey
	// in apps/hono-api/.../task.kling-motion-control.ts).
	//
	// API: POST /v1/videos/generations with model=kling-v{2-6,3}-motion-control.
	// Required upstream fields: image_url, video_url, character_orientation
	// (image|video), mode (std|pro). Duration: image-anchored 3-10s,
	// video-anchored 3-30s.
	//
	// Retail USD/s (after 20% markup):
	//   v2.6 std=$0.0714 pro=$0.1143   → CNY/s std=0.6254 pro=1.0013
	//   v3   std=$0.1286 pro=$0.1714   → CNY/s std=1.1266 pro=1.5014
	"kling-v2-6-motion-control": {
		{resolution: "std", cnyPerSecond: 0.6254},
		{resolution: "pro", cnyPerSecond: 1.0013},
	},
	"kling-v2-6-motion-control-apimart": {
		{resolution: "std", cnyPerSecond: 0.6254},
		{resolution: "pro", cnyPerSecond: 1.0013},
	},
	"kling-v3-motion-control": {
		{resolution: "std", cnyPerSecond: 1.1266},
		{resolution: "pro", cnyPerSecond: 1.5014},
	},
	"kling-v3-motion-control-apimart": {
		{resolution: "std", cnyPerSecond: 1.1266},
		{resolution: "pro", cnyPerSecond: 1.5014},
	},
	// Magic666 unified Sora2: 4s=¥0.4, 8s=¥0.8, 12s=¥1.2.
	"sora2": {
		{resolution: "720p", cnyPerSecond: 0.1},
	},
}

// fixedVideoPricingSpec encodes a flat CNY price for a single (resolution × duration) spec.
// Used when per-second pricing is not linear — e.g. APIMart tiered flat pricing.
type fixedVideoPricingSpec struct {
	resolution string
	duration   int
	cnyPrice   float64
}

// fixedVideoPricingSpecs maps canonical model name → flat per-spec prices.
// spec_key emitted is `video:{resolution}:{duration}s`, matching the linear video format
// so the billing path in hono-api (buildVideoBillingSpecKey) works without changes.
//
// Pricing source: APIMart official price (current / 0.8) × 1.2 (20% markup) × 7.3 (USD→CNY).
var fixedVideoPricingSpecs = map[string][]fixedVideoPricingSpec{
	// omni-flash-ext: Gemini v4.6.4 extended video generation (APIMart).
	// 720P = 1080P price for same duration; 4K is higher.
	// Official price = APIMart current / 0.8. Our price = official × 1.2 × 7.3.
	"omni-flash-ext": {
		{resolution: "720p",  duration: 4,  cnyPrice: 1.6425},
		{resolution: "720p",  duration: 6,  cnyPrice: 1.8615},
		{resolution: "720p",  duration: 8,  cnyPrice: 1.9710},
		{resolution: "720p",  duration: 10, cnyPrice: 2.1900},
		{resolution: "1080p", duration: 4,  cnyPrice: 1.6425},
		{resolution: "1080p", duration: 6,  cnyPrice: 1.8615},
		{resolution: "1080p", duration: 8,  cnyPrice: 1.9710},
		{resolution: "1080p", duration: 10, cnyPrice: 2.1900},
		{resolution: "4k",    duration: 4,  cnyPrice: 3.2850},
		{resolution: "4k",    duration: 6,  cnyPrice: 3.7230},
		{resolution: "4k",    duration: 8,  cnyPrice: 3.9420},
		{resolution: "4k",    duration: 10, cnyPrice: 4.3800},
	},
}

var (
	modelSupportEndpointTypes = make(map[string][]constant.EndpointType)
	modelSupportEndpointsLock = sync.RWMutex{}
)

func GetPricing() []Pricing {
	if time.Since(lastGetPricingTime) > time.Minute*1 || len(pricingMap) == 0 {
		updatePricingLock.Lock()
		defer updatePricingLock.Unlock()
		// Double check after acquiring the lock
		if time.Since(lastGetPricingTime) > time.Minute*1 || len(pricingMap) == 0 {
			modelSupportEndpointsLock.Lock()
			defer modelSupportEndpointsLock.Unlock()
			updatePricing()
		}
	}
	return pricingMap
}

// GetVendors 返回当前定价接口使用到的供应商信息
func GetVendors() []PricingVendor {
	if time.Since(lastGetPricingTime) > time.Minute*1 || len(pricingMap) == 0 {
		// 保证先刷新一次
		GetPricing()
	}
	return vendorsList
}

func GetModelSupportEndpointTypes(model string) []constant.EndpointType {
	model = CanonicalModelKey(model)
	if model == "" {
		return make([]constant.EndpointType, 0)
	}
	modelSupportEndpointsLock.RLock()
	defer modelSupportEndpointsLock.RUnlock()
	if endpoints, ok := modelSupportEndpointTypes[model]; ok {
		return endpoints
	}
	return make([]constant.EndpointType, 0)
}

func formatUSD(value float64) string {
	return fmt.Sprintf("$%.2f", value)
}

func formatCNY(value float64) string {
	return fmt.Sprintf("¥%.6f", value)
}

func imageSpecKey(aspectRatio string, resolution string, quality string) string {
	normalizedAspect := strings.ReplaceAll(strings.TrimSpace(strings.ToLower(aspectRatio)), ":", "_")
	normalizedResolution := strings.TrimSpace(strings.ToLower(resolution))
	normalizedQuality := strings.TrimSpace(strings.ToLower(quality))
	return fmt.Sprintf("image:%s:%s:%s", normalizedAspect, normalizedResolution, normalizedQuality)
}

func apimartUSDToPremiumCNY(value float64) float64 {
	return value * 7.3 * 1.6
}

func fixedImagePricingRules(modelName string) []fixedImagePricingRule {
	switch CanonicalModelKey(modelName) {
	case "gemini-2.5-flash-image-preview":
		return []fixedImagePricingRule{
			{specKey: "image:1k", resolution: "1k", apimartCurrentUSD: 0.0125},
		}
	case "gemini-3-pro-image-preview":
		return []fixedImagePricingRule{
			{specKey: "image:1k", resolution: "1k", cnyPrice: 0.7},
			{specKey: "image:2k", resolution: "2k", cnyPrice: 0.7},
			{specKey: "image:4k", resolution: "4k", cnyPrice: 0.9},
		}
	case "gemini-3.1-flash-image-preview":
		return []fixedImagePricingRule{
			{specKey: "image:1k", resolution: "1k", cnyPrice: 0.6},
			{specKey: "image:2k", resolution: "2k", cnyPrice: 0.7},
			{specKey: "image:4k", resolution: "4k", cnyPrice: 1.1},
		}
	case "gemini-3-pro-image-preview-ultra":
		return []fixedImagePricingRule{
			{specKey: "image:1k", resolution: "1k", cnyPrice: 2.6},
			{specKey: "image:2k", resolution: "2k", cnyPrice: 3.1},
			{specKey: "image:4k", resolution: "4k", cnyPrice: 4.1},
		}
	case "gemini-3.1-flash-image-preview-ultra":
		return []fixedImagePricingRule{
			{specKey: "image:1k", resolution: "1k", cnyPrice: 1.6},
			{specKey: "image:2k", resolution: "2k", cnyPrice: 2.3},
			{specKey: "image:4k", resolution: "4k", cnyPrice: 2.6},
		}
	case "gpt-image-2", "gpt-image-2-vip":
		return []fixedImagePricingRule{
			{specKey: "image:1k", resolution: "1k", cnyPrice: 0.2},
			{specKey: "image:2k", resolution: "2k", cnyPrice: 0.3},
			{specKey: "image:4k", resolution: "4k", cnyPrice: 0.4},
		}
	// Official-tier models: fixed CNY prices corresponding to official API pricing.
	case "gpt-image-2-official", "gemini-3-pro-image-preview-official":
		return []fixedImagePricingRule{
			{specKey: "image:1k", resolution: "1k", cnyPrice: 1.5},
			{specKey: "image:2k", resolution: "2k", cnyPrice: 1.8},
			{specKey: "image:4k", resolution: "4k", cnyPrice: 2.5},
		}
	default:
		return nil
	}
}

func fixedImageRuleCNY(rule fixedImagePricingRule) float64 {
	if rule.cnyPrice > 0 {
		return rule.cnyPrice
	}
	return apimartUSDToPremiumCNY(rule.apimartCurrentUSD)
}

// FixedImagePriceCNYForTier returns the per-image CNY price for modelName at the given
// resolution tier ("1K", "2K", or "4K"). Returns (0, false) if the model has no
// fixed image pricing rules or the tier is not covered.
func FixedImagePriceCNYForTier(modelName, resolutionTier string) (float64, bool) {
	rules := fixedImagePricingRules(modelName)
	if len(rules) == 0 {
		return 0, false
	}
	for _, rule := range rules {
		if strings.EqualFold(strings.TrimSpace(rule.resolution), strings.TrimSpace(resolutionTier)) {
			price := fixedImageRuleCNY(rule)
			if price > 0 {
				return price, true
			}
		}
	}
	return 0, false
}

func fixedImageBasePriceCNY(modelName string) (float64, bool) {
	rules := fixedImagePricingRules(modelName)
	if len(rules) == 0 {
		return 0, false
	}
	minPrice := math.Inf(1)
	for _, rule := range rules {
		priceCNY := fixedImageRuleCNY(rule)
		if priceCNY > 0 && priceCNY < minPrice {
			minPrice = priceCNY
		}
	}
	if !math.IsInf(minPrice, 1) {
		return minPrice, true
	}
	return 0, false
}

func extractDurationOptions(meta *Model) []int {
	if meta == nil || strings.TrimSpace(meta.ParamsDef) == "" {
		return nil
	}
	var raw []map[string]any
	if err := json.Unmarshal([]byte(meta.ParamsDef), &raw); err != nil {
		return nil
	}
	for _, item := range raw {
		key, _ := item["key"].(string)
		if key != "duration" {
			continue
		}
		options, _ := item["options"].([]any)
		out := make([]int, 0, len(options))
		for _, option := range options {
			record, ok := option.(map[string]any)
			if !ok {
				continue
			}
			value, ok := record["value"]
			if !ok {
				continue
			}
			switch typed := value.(type) {
			case float64:
				if typed > 0 && math.Trunc(typed) == typed {
					out = append(out, int(typed))
				}
			case int:
				if typed > 0 {
					out = append(out, typed)
				}
			}
		}
		if len(out) > 0 {
			return out
		}
	}
	return nil
}

func buildParamPricing(modelName string, meta *Model) *ParamPricing {
	imageRules := fixedImagePricingRules(modelName)
	if len(imageRules) > 0 {
		results := make([]ParamPricingResult, 0, len(imageRules))
		for _, rule := range imageRules {
			priceCNY := fixedImageRuleCNY(rule)
			specKey := strings.TrimSpace(rule.specKey)
			if specKey == "" {
				specKey = imageSpecKey(rule.aspectRatio, rule.resolution, rule.quality)
			}
			results = append(results, ParamPricingResult{
				SpecKey:         specKey,
				Resolution:      strings.TrimSpace(strings.ToLower(rule.resolution)),
				PriceCNY:        priceCNY,
				PriceDisplayCNY: formatCNY(priceCNY),
			})
		}
		return &ParamPricing{
			Currency:    "CNY",
			BillingMode: "fixed_by_image_spec",
			Formula:     "price_cny = apimart_current_price_usd * 7.3 * 1.6",
			Results:     results,
		}
	}

	// Fixed per-spec video pricing (non-linear: price differs per duration+resolution combo).
	fixedVideoSpecs, hasFixedVideo := fixedVideoPricingSpecs[CanonicalModelKey(modelName)]
	if hasFixedVideo && len(fixedVideoSpecs) > 0 {
		results := make([]ParamPricingResult, 0, len(fixedVideoSpecs))
		for _, spec := range fixedVideoSpecs {
			results = append(results, ParamPricingResult{
				SpecKey:         fmt.Sprintf("video:%s:%ds", spec.resolution, spec.duration),
				DurationSeconds: spec.duration,
				Resolution:      spec.resolution,
				PriceCNY:        spec.cnyPrice,
				PriceDisplayCNY: formatCNY(spec.cnyPrice),
			})
		}
		return &ParamPricing{
			Currency:    "CNY",
			BillingMode: "fixed_by_video_spec",
			Formula:     "price_cny = official_usd * 1.2 * 7.3  (official_usd = apimart_current / 0.8)",
			Results:     results,
		}
	}

	rules, ok := linearVideoPricingRules[CanonicalModelKey(modelName)]
	if !ok || len(rules) == 0 {
		return nil
	}
	durations := extractDurationOptions(meta)
	if len(durations) == 0 {
		durations = []int{4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15}
	}
	results := make([]ParamPricingResult, 0, len(durations)*len(rules))
	formulaLines := make([]string, 0, len(rules))
	for _, rule := range rules {
		formulaLines = append(formulaLines, fmt.Sprintf("%s: price_cny = duration_seconds * %.2f", rule.resolution, rule.cnyPerSecond))
		for _, duration := range durations {
			priceCNY := rule.cnyPerSecond * float64(duration)
			results = append(results, ParamPricingResult{
				SpecKey:         fmt.Sprintf("video:%s:%ds", rule.resolution, duration),
				DurationSeconds: duration,
				Resolution:      rule.resolution,
				PriceCNY:        priceCNY,
				PriceDisplayCNY: formatCNY(priceCNY),
			})
		}
	}
	return &ParamPricing{
		Currency:    "CNY",
		BillingMode: "linear_by_duration_and_resolution",
		Formula:     strings.Join(formulaLines, "; "),
		Results:     results,
	}
}

func updatePricing() {
	//modelRatios := common.GetModelRatios()
	enableAbilities, err := GetAllEnableAbilityWithChannels()
	if err != nil {
		common.SysLog(fmt.Sprintf("GetAllEnableAbilityWithChannels error: %v", err))
		return
	}
	// 预加载模型元数据与供应商一次，避免循环查询
	var allMeta []Model
	_ = DB.Find(&allMeta).Error
	metaMap := make(map[string]*Model)
	prefixList := make([]*Model, 0)
	suffixList := make([]*Model, 0)
	containsList := make([]*Model, 0)
	for i := range allMeta {
		m := &allMeta[i]
		if m.NameRule == NameRuleExact {
			metaMap[m.ModelName] = m
		} else {
			switch m.NameRule {
			case NameRulePrefix:
				prefixList = append(prefixList, m)
			case NameRuleSuffix:
				suffixList = append(suffixList, m)
			case NameRuleContains:
				containsList = append(containsList, m)
			}
		}
	}

	// 将非精确规则模型匹配到 metaMap
	for _, m := range prefixList {
		for _, pricingModel := range enableAbilities {
			if strings.HasPrefix(pricingModel.Model, m.ModelName) {
				if _, exists := metaMap[pricingModel.Model]; !exists {
					metaMap[pricingModel.Model] = m
				}
			}
		}
	}
	for _, m := range suffixList {
		for _, pricingModel := range enableAbilities {
			if strings.HasSuffix(pricingModel.Model, m.ModelName) {
				if _, exists := metaMap[pricingModel.Model]; !exists {
					metaMap[pricingModel.Model] = m
				}
			}
		}
	}
	for _, m := range containsList {
		for _, pricingModel := range enableAbilities {
			if strings.Contains(pricingModel.Model, m.ModelName) {
				if _, exists := metaMap[pricingModel.Model]; !exists {
					metaMap[pricingModel.Model] = m
				}
			}
		}
	}

	// 预加载供应商
	var vendors []Vendor
	_ = DB.Find(&vendors).Error
	vendorMap := make(map[int]*Vendor)
	for i := range vendors {
		vendorMap[vendors[i].Id] = &vendors[i]
	}

	// 初始化默认供应商映射
	initDefaultVendorMapping(metaMap, vendorMap, enableAbilities)

	// 构建对前端友好的供应商列表
	vendorsList = make([]PricingVendor, 0, len(vendorMap))
	for _, v := range vendorMap {
		vendorsList = append(vendorsList, PricingVendor{
			ID:          v.Id,
			Name:        v.Name,
			Description: v.Description,
			Icon:        v.Icon,
		})
	}

	modelGroupsMap := make(map[string]*types.Set[string])
	canonicalMetaMap := make(map[string]*Model)

	// Pre-bucket every loaded model row by its canonical name so we can pick
	// an enabled candidate even when the ability points at a disabled name.
	// Example: APIMart channel exposes ability.Model='kling-v3' (the canonical
	// name) but the matching row id=7 is the Yunwu mirror (disabled). The
	// enabled row id=160 has model_name='kling-v3-apimart' which collapses
	// to the same canonical. Without this lookup we'd bind the disabled row
	// and skip ParamPricing for the whole canonical model (see the
	// `if meta.Status != 1 { continue }` guard later in this function).
	metaByCanonical := make(map[string][]*Model)
	for name, m := range metaMap {
		if m == nil {
			continue
		}
		canonical := CanonicalModelKey(name)
		if canonical == "" {
			continue
		}
		metaByCanonical[canonical] = append(metaByCanonical[canonical], m)
	}
	pickCanonicalMeta := func(canonical, abilityModel string) *Model {
		candidates := metaByCanonical[canonical]
		if len(candidates) == 0 {
			if m, ok := metaMap[abilityModel]; ok {
				return m
			}
			return nil
		}
		// Priority order:
		//   1) enabled row whose model_name == canonical
		//   2) enabled row whose model_name == ability.Model
		//   3) any enabled row collapsing to this canonical
		//   4) disabled fallback whose model_name == canonical (back-compat)
		//   5) any row collapsing to this canonical
		var (
			enabledExact   *Model
			enabledAbility *Model
			enabledAny     *Model
			disabledExact  *Model
			disabledAny    *Model
		)
		for _, m := range candidates {
			if m.Status == 1 {
				if enabledAny == nil {
					enabledAny = m
				}
				if m.ModelName == canonical && enabledExact == nil {
					enabledExact = m
				}
				if m.ModelName == abilityModel && enabledAbility == nil {
					enabledAbility = m
				}
			} else {
				if disabledAny == nil {
					disabledAny = m
				}
				if m.ModelName == canonical && disabledExact == nil {
					disabledExact = m
				}
			}
		}
		switch {
		case enabledExact != nil:
			return enabledExact
		case enabledAbility != nil:
			return enabledAbility
		case enabledAny != nil:
			return enabledAny
		case disabledExact != nil:
			return disabledExact
		default:
			return disabledAny
		}
	}

	for _, ability := range enableAbilities {
		canonicalModel := CanonicalModelKey(ability.Model)
		if canonicalModel == "" {
			continue
		}
		groups, ok := modelGroupsMap[canonicalModel]
		if !ok {
			groups = types.NewSet[string]()
			modelGroupsMap[canonicalModel] = groups
		}
		groups.Add(ability.Group)
		if _, exists := canonicalMetaMap[canonicalModel]; !exists {
			if meta := pickCanonicalMeta(canonicalModel, ability.Model); meta != nil {
				canonicalMetaMap[canonicalModel] = meta
			}
		}
	}

	//这里使用切片而不是Set，因为一个模型可能支持多个端点类型，并且第一个端点是优先使用端点
	modelSupportEndpointsStr := make(map[string][]string)

	// 先根据已有能力填充原生端点
	for _, ability := range enableAbilities {
		canonicalModel := CanonicalModelKey(ability.Model)
		if canonicalModel == "" {
			continue
		}
		endpoints := modelSupportEndpointsStr[canonicalModel]
		channelTypes := common.GetEndpointTypesByChannelType(ability.ChannelType, canonicalModel)
		for _, channelType := range channelTypes {
			if !common.StringsContains(endpoints, string(channelType)) {
				endpoints = append(endpoints, string(channelType))
			}
		}
		modelSupportEndpointsStr[canonicalModel] = endpoints
	}

	// 再补充模型自定义端点：若配置有效则替换默认端点，不做合并
	for modelName, meta := range canonicalMetaMap {
		if strings.TrimSpace(meta.Endpoints) == "" {
			continue
		}
		var raw map[string]interface{}
		if err := json.Unmarshal([]byte(meta.Endpoints), &raw); err == nil {
			endpoints := make([]string, 0, len(raw))
			for k, v := range raw {
				switch v.(type) {
				case string, map[string]interface{}:
					if !common.StringsContains(endpoints, k) {
						endpoints = append(endpoints, k)
					}
				}
			}
			if len(endpoints) > 0 {
				modelSupportEndpointsStr[modelName] = endpoints
			}
		}
	}

	modelSupportEndpointTypes = make(map[string][]constant.EndpointType)
	for model, endpoints := range modelSupportEndpointsStr {
		supportedEndpoints := make([]constant.EndpointType, 0)
		for _, endpointStr := range endpoints {
			endpointType := constant.EndpointType(endpointStr)
			supportedEndpoints = append(supportedEndpoints, endpointType)
		}
		modelSupportEndpointTypes[model] = supportedEndpoints
	}

	// 构建全局 supportedEndpointMap（默认 + 自定义覆盖）
	supportedEndpointMap = make(map[string]common.EndpointInfo)
	// 1. 默认端点
	for _, endpoints := range modelSupportEndpointTypes {
		for _, et := range endpoints {
			if info, ok := common.GetDefaultEndpointInfo(et); ok {
				if _, exists := supportedEndpointMap[string(et)]; !exists {
					supportedEndpointMap[string(et)] = info
				}
			}
		}
	}
	// 2. 自定义端点（models 表）覆盖默认
	for _, meta := range canonicalMetaMap {
		if strings.TrimSpace(meta.Endpoints) == "" {
			continue
		}
		var raw map[string]interface{}
		if err := json.Unmarshal([]byte(meta.Endpoints), &raw); err == nil {
			for k, v := range raw {
				switch val := v.(type) {
				case string:
					supportedEndpointMap[k] = common.EndpointInfo{Path: val, Method: "POST"}
				case map[string]interface{}:
					ep := common.EndpointInfo{Method: "POST"}
					if p, ok := val["path"].(string); ok {
						ep.Path = p
					}
					if m, ok := val["method"].(string); ok {
						ep.Method = strings.ToUpper(m)
					}
					supportedEndpointMap[k] = ep
				default:
					// ignore unsupported types
				}
			}
		}
	}

	pricingMap = make([]Pricing, 0)
	for model, groups := range modelGroupsMap {
		pricing := Pricing{
			ModelName:              model,
			EnableGroup:            groups.Items(),
			SupportedEndpointTypes: modelSupportEndpointTypes[model],
		}

		// 补充模型元数据（描述、标签、供应商、状态）
		if meta, ok := canonicalMetaMap[model]; ok {
			// 若模型被禁用(status!=1)，则直接跳过，不返回给前端
			if meta.Status != 1 {
				continue
			}
			pricing.Description = meta.Description
			pricing.Icon = meta.Icon
			pricing.Tags = meta.Tags
			pricing.VendorID = meta.VendorID
			pricing.ParamPricing = buildParamPricing(model, meta)
		}
		if pricing.ParamPricing == nil {
			pricing.ParamPricing = buildParamPricing(model, nil)
		}
		modelPrice, findPrice := fixedImageBasePriceCNY(model)
		if !findPrice {
			modelPrice, findPrice = findCanonicalModelPrice(model)
		}
		if findPrice {
			pricing.ModelPrice = modelPrice
			pricing.QuotaType = 1
		} else {
			modelRatio, completionRatio := findCanonicalModelRatio(model)
			pricing.ModelRatio = modelRatio
			pricing.CompletionRatio = completionRatio
			pricing.QuotaType = 0
		}
		if cacheRatio, ok := findCanonicalCacheRatio(model); ok {
			pricing.CacheRatio = &cacheRatio
		}
		if createCacheRatio, ok := findCanonicalCreateCacheRatio(model); ok {
			pricing.CreateCacheRatio = &createCacheRatio
		}
		if imageRatio, ok := findCanonicalImageRatio(model); ok {
			pricing.ImageRatio = &imageRatio
		}
		if audioRatio, ok := findCanonicalAudioRatio(model); ok {
			pricing.AudioRatio = &audioRatio
		}
		if audioCompletionRatio, ok := findCanonicalAudioCompletionRatio(model); ok {
			pricing.AudioCompletionRatio = &audioCompletionRatio
		}
		pricingMap = append(pricingMap, pricing)
	}

	// 防止大更新后数据不通用
	if len(pricingMap) > 0 {
		pricingMap[0].PricingVersion = "5a90f2b86c08bd983a9a2e6d66c255f4eaef9c4bc934386d2b6ae84ef0ff1f1f"
	}

	// 刷新缓存映射，供高并发快速查询
	modelEnableGroupsLock.Lock()
	modelEnableGroups = make(map[string][]string)
	modelQuotaTypeMap = make(map[string]int)
	modelKindMap = make(map[string]string)
	for _, p := range pricingMap {
		modelEnableGroups[p.ModelName] = p.EnableGroup
		modelQuotaTypeMap[p.ModelName] = p.QuotaType
	}
	for i := range allMeta {
		m := &allMeta[i]
		if m.Kind != "" {
			modelKindMap[m.ModelName] = m.Kind
		}
	}
	modelEnableGroupsLock.Unlock()

	lastGetPricingTime = time.Now()
}

// GetSupportedEndpointMap 返回全局端点到路径的映射
func GetSupportedEndpointMap() map[string]common.EndpointInfo {
	return supportedEndpointMap
}

func findCanonicalModelPrice(model string) (float64, bool) {
	for _, candidate := range RoutingModelCandidates(model) {
		if value, ok := ratio_setting.GetModelPrice(candidate, false); ok {
			return value, true
		}
	}
	return 0, false
}

func findCanonicalModelRatio(model string) (float64, float64) {
	for _, candidate := range RoutingModelCandidates(model) {
		if ratio, _, _ := ratio_setting.GetModelRatio(candidate); ratio != 0 {
			return ratio, ratio_setting.GetCompletionRatio(candidate)
		}
	}
	return 0, 0
}

func findCanonicalCacheRatio(model string) (float64, bool) {
	for _, candidate := range RoutingModelCandidates(model) {
		if value, ok := ratio_setting.GetCacheRatio(candidate); ok {
			return value, true
		}
	}
	return 0, false
}

func findCanonicalCreateCacheRatio(model string) (float64, bool) {
	for _, candidate := range RoutingModelCandidates(model) {
		if value, ok := ratio_setting.GetCreateCacheRatio(candidate); ok {
			return value, true
		}
	}
	return 0, false
}

func findCanonicalImageRatio(model string) (float64, bool) {
	for _, candidate := range RoutingModelCandidates(model) {
		if value, ok := ratio_setting.GetImageRatio(candidate); ok {
			return value, true
		}
	}
	return 0, false
}

func findCanonicalAudioRatio(model string) (float64, bool) {
	for _, candidate := range RoutingModelCandidates(model) {
		if ratio_setting.ContainsAudioRatio(candidate) {
			return ratio_setting.GetAudioRatio(candidate), true
		}
	}
	return 0, false
}

func findCanonicalAudioCompletionRatio(model string) (float64, bool) {
	for _, candidate := range RoutingModelCandidates(model) {
		if ratio_setting.ContainsAudioCompletionRatio(candidate) {
			return ratio_setting.GetAudioCompletionRatio(candidate), true
		}
	}
	return 0, false
}
