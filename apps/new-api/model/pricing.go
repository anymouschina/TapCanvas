package model

import (
	"encoding/json"
	"fmt"
	"math"
	"sort"
	"strings"

	"sync"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/dto"
	"github.com/QuantumNous/new-api/setting/ratio_setting"
	"github.com/QuantumNous/new-api/types"
)

type Pricing struct {
	ModelName              string                  `json:"model_name"`
	ModelKind              string                  `json:"model_kind,omitempty"`
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
	Currency                string               `json:"currency"`
	BillingMode             string               `json:"billing_mode"`
	Formula                 string               `json:"formula,omitempty"`
	ReferenceImageFreeCount int                  `json:"reference_image_free_count,omitempty"`
	ReferenceImagePriceCNY  float64              `json:"reference_image_price_cny,omitempty"`
	Results                 []ParamPricingResult `json:"results,omitempty"`
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
	modelEnableGroups        = make(map[string][]string)
	modelQuotaTypeMap        = make(map[string]int)
	modelKindMap             = make(map[string]string)
	modelEnableGroupsLock    = sync.RWMutex{}
	configuredPricingByModel = make(map[string]ModelPricingConfig)
	configuredPricingLock    sync.RWMutex
)

type linearVideoPricingRule struct {
	resolution   string
	cnyPerSecond float64
}

type fixedImagePricingRule struct {
	specKey     string
	aspectRatio string
	resolution  string
	quality     string
	cnyPrice    float64
}

// Rates in CNY per second; credits = ceil(cnyPerSecond * durationSeconds * creditsPerCny).
// Source: APIMart official prices ($/s) × 7.3 (USD→CNY) × 1.2 (20% markup). TapCanvas currently uses 100 credits/CNY.
// 2026-05-17: All video model rates increased by 20%.
var linearVideoPricingRules = map[string][]linearVideoPricingRule{
	// Seedance 2.5 retail pricing is aligned with Tanva: 1.5x the current
	// Seedance 2.0 retail rate after its 1.5/1.2 price-scale adjustment.
	"doubao-seedance-2.5": {
		{resolution: "480p", cnyPerSecond: 1.875},
		{resolution: "720p", cnyPerSecond: 2.25},
	},
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
		{resolution: "720p+video", cnyPerSecond: 1.6556},
		{resolution: "1080p+video", cnyPerSecond: 2.2075},
		{resolution: "4k", cnyPerSecond: 4.6927},
		{resolution: "4k+sound", cnyPerSecond: 4.6927},
	},
	"kling-v3-apimart": {
		{resolution: "720p", cnyPerSecond: 0.7358},
		{resolution: "1080p", cnyPerSecond: 0.9811},
		{resolution: "720p+sound", cnyPerSecond: 1.1038},
		{resolution: "1080p+sound", cnyPerSecond: 1.4717},
		{resolution: "720p+video", cnyPerSecond: 1.6556},
		{resolution: "1080p+video", cnyPerSecond: 2.2075},
		{resolution: "4k", cnyPerSecond: 4.6927},
		{resolution: "4k+sound", cnyPerSecond: 4.6927},
	},
	// Shared public price sources for the same-name FunAI models. The FunAI
	// channel applies price_ratio=0.5 at runtime and during publication; these
	// rules remain the single full-price source and are not copied per channel.
	"seedance-2.0": {
		{resolution: "720p", cnyPerSecond: 0.2400},
	},
	"kling-o3": {
		{resolution: "720p", cnyPerSecond: 0.0600},
		{resolution: "1080p", cnyPerSecond: 0.0600},
		{resolution: "2160p", cnyPerSecond: 0.0600},
		{resolution: "4k", cnyPerSecond: 0.0600},
	},
	// --- Evolink (api.evolink.ai) video models -------------------------------
	// Pricing aligned to APIMart's equivalents (user directive 2026-06-22):
	//   kling-o3-*  → APIMart kling-v3 rates
	//   seedance-2.0(-reference) → APIMart doubao-seedance-2.0 rates
	//   seedance-2.0-fast-*      → APIMart doubao-seedance-2.0-fast rates
	//   seedance-2.0-mini-*      → no APIMart "mini" tier; use the closest cheaper
	//                              tier (fast). Adjust in admin if Evolink prices it lower.
	// These feed the /api/pricing snapshot only; the new-api charge is flat per
	// call (see defaultModelPrice + the BaseBilling TaskAdaptor), matching APIMart.
	"kling-o3-image-to-video": {
		{resolution: "720p", cnyPerSecond: 0.7358},
		{resolution: "1080p", cnyPerSecond: 0.9811},
	},
	"kling-o3-reference-to-video": {
		{resolution: "720p", cnyPerSecond: 0.7358},
		{resolution: "1080p", cnyPerSecond: 0.9811},
	},
	"kling-o3-video-edit": {
		{resolution: "720p", cnyPerSecond: 0.7358},
		{resolution: "1080p", cnyPerSecond: 0.9811},
	},
	"seedance-2.0-reference-to-video": {
		{resolution: "480p", cnyPerSecond: 0.7945},
		{resolution: "720p", cnyPerSecond: 1.7100},
		{resolution: "1080p", cnyPerSecond: 3.8544},
	},
	"seedance-2.0-fast-image-to-video": {
		{resolution: "480p", cnyPerSecond: 0.6395},
		{resolution: "720p", cnyPerSecond: 1.3753},
		{resolution: "1080p", cnyPerSecond: 1.3753},
	},
	"seedance-2.0-fast-reference-to-video": {
		{resolution: "480p", cnyPerSecond: 0.6395},
		{resolution: "720p", cnyPerSecond: 1.3753},
		{resolution: "1080p", cnyPerSecond: 1.3753},
	},
	"seedance-2.0-mini-reference-to-video": {
		{resolution: "480p", cnyPerSecond: 0.6395},
		{resolution: "720p", cnyPerSecond: 1.3753},
		{resolution: "1080p", cnyPerSecond: 1.3753},
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
	// pixverse-v6: APIMart 官方价(USD/s) × 7.3 (USD→CNY) × 2 (markup).
	// NOTE: 倍率 ×2 是本模型专属，区别于其它视频模型的 ×1.2；audio 档用 +sound 后缀。
	//   360p $0.02, 540p $0.03, 720p $0.04, 1080p $0.08
	//   360p+audio $0.03, 540p+audio $0.04, 720p+audio $0.05, 1080p+audio $0.10
	"pixverse-v6": {
		{resolution: "360p", cnyPerSecond: 0.292},
		{resolution: "540p", cnyPerSecond: 0.438},
		{resolution: "720p", cnyPerSecond: 0.584},
		{resolution: "1080p", cnyPerSecond: 1.168},
		{resolution: "360p+sound", cnyPerSecond: 0.438},
		{resolution: "540p+sound", cnyPerSecond: 0.584},
		{resolution: "720p+sound", cnyPerSecond: 0.730},
		{resolution: "1080p+sound", cnyPerSecond: 1.460},
	},
	"pixverse-v6-apimart": {
		{resolution: "360p", cnyPerSecond: 0.292},
		{resolution: "540p", cnyPerSecond: 0.438},
		{resolution: "720p", cnyPerSecond: 0.584},
		{resolution: "1080p", cnyPerSecond: 1.168},
		{resolution: "360p+sound", cnyPerSecond: 0.438},
		{resolution: "540p+sound", cnyPerSecond: 0.584},
		{resolution: "720p+sound", cnyPerSecond: 0.730},
		{resolution: "1080p+sound", cnyPerSecond: 1.460},
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
	// MiniMax H3 via Metaso uses the operator's explicit public retail table.
	// It is not derived from the shared 30% channel markup used by Megaby.
	"minimax-h3": {
		{resolution: "768p", cnyPerSecond: 0.24},
		{resolution: "1440p", cnyPerSecond: 0.40},
	},
	// grok-imagine-1.5-video: APIMart 官方价 $0.00875/s × 7.3 (USD→CNY) × 1.6 (markup)
	//   = 0.1022 CNY/s. Flat across the 480p/720p `quality` tiers (single upstream
	//   per-second price), so both resolution keys carry the same rate.
	"grok-imagine-1.5-video": {
		{resolution: "480p", cnyPerSecond: 0.1022},
		{resolution: "720p", cnyPerSecond: 0.1022},
	},
	"grok-imagine-1.5-video-apimart": {
		{resolution: "480p", cnyPerSecond: 0.1022},
		{resolution: "720p", cnyPerSecond: 0.1022},
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
		{resolution: "720p", duration: 4, cnyPrice: 1.6425},
		{resolution: "720p", duration: 6, cnyPrice: 1.8615},
		{resolution: "720p", duration: 8, cnyPrice: 1.9710},
		{resolution: "720p", duration: 10, cnyPrice: 2.1900},
		{resolution: "1080p", duration: 4, cnyPrice: 1.6425},
		{resolution: "1080p", duration: 6, cnyPrice: 1.8615},
		{resolution: "1080p", duration: 8, cnyPrice: 1.9710},
		{resolution: "1080p", duration: 10, cnyPrice: 2.1900},
		{resolution: "4k", duration: 4, cnyPrice: 3.2850},
		{resolution: "4k", duration: 6, cnyPrice: 3.7230},
		{resolution: "4k", duration: 8, cnyPrice: 3.9420},
		{resolution: "4k", duration: 10, cnyPrice: 4.3800},
	},
}

var (
	modelSupportEndpointTypes = make(map[string][]constant.EndpointType)
	modelSupportEndpointsLock = sync.RWMutex{}
)

func GetPricing() []Pricing {
	pricing, err := GetPricingWithError()
	if err != nil {
		common.SysError("refresh pricing failed: " + err.Error())
	}
	return pricing
}

// GetPricingWithError returns the current pricing snapshot and surfaces cache
// refresh failures to management APIs instead of presenting stale data as a
// successful refresh.
func GetPricingWithError() ([]Pricing, error) {
	snapshot, err := GetPricingCatalogSnapshotWithError()
	return snapshot.Pricing, err
}

func GetModelSupportEndpointTypes(model string) []constant.EndpointType {
	model = CanonicalModelKey(model)
	if model == "" {
		return make([]constant.EndpointType, 0)
	}
	modelSupportEndpointsLock.RLock()
	defer modelSupportEndpointsLock.RUnlock()
	if endpoints, ok := modelSupportEndpointTypes[model]; ok {
		return cloneEndpointTypes(endpoints)
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

func fixedImagePricingRules(modelName string) []fixedImagePricingRule {
	switch CanonicalModelKey(modelName) {
	case "gemini-2.5-flash-image-preview":
		return []fixedImagePricingRule{
			{specKey: "image:1k", resolution: "1k", cnyPrice: 0.4},
		}
	case "gemini-3-pro-image-preview":
		return []fixedImagePricingRule{
			{specKey: "image:1k", resolution: "1k", cnyPrice: 1.3},
			{specKey: "image:2k", resolution: "2k", cnyPrice: 1.3},
			{specKey: "image:4k", resolution: "4k", cnyPrice: 2.4},
		}
	case "gemini-3.1-flash-image-preview":
		return []fixedImagePricingRule{
			{specKey: "image:0.5k", resolution: "0.5k", cnyPrice: 0.45},
			{specKey: "image:1k", resolution: "1k", cnyPrice: 0.65},
			{specKey: "image:2k", resolution: "2k", cnyPrice: 1.0},
			{specKey: "image:4k", resolution: "4k", cnyPrice: 1.55},
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
	// saver = mlai-gemini 特价渠道对外名称（1 点 = ¥0.1）：1K=3pt 2K=3pt 4K=5pt。
	// 与 -ultra 同构：底模同为 gemini-3-pro-image-preview，仅渠道与定价不同。
	case "gemini-3-pro-image-preview-saver":
		return []fixedImagePricingRule{
			{specKey: "image:1k", resolution: "1k", cnyPrice: 0.3},
			{specKey: "image:2k", resolution: "2k", cnyPrice: 0.3},
			{specKey: "image:4k", resolution: "4k", cnyPrice: 0.5},
		}
	case "gpt-image-2":
		return []fixedImagePricingRule{
			{specKey: "image:1k:low", resolution: "1k", quality: "low", cnyPrice: 0.3},
			{specKey: "image:2k:low", resolution: "2k", quality: "low", cnyPrice: 0.4},
			{specKey: "image:4k:low", resolution: "4k", quality: "low", cnyPrice: 0.5},
			{specKey: "image:1k:medium", resolution: "1k", quality: "medium", cnyPrice: 0.6},
			{specKey: "image:2k:medium", resolution: "2k", quality: "medium", cnyPrice: 1.2},
			{specKey: "image:4k:medium", resolution: "4k", quality: "medium", cnyPrice: 1.9},
			{specKey: "image:1k:high", resolution: "1k", quality: "high", cnyPrice: 2.3},
			{specKey: "image:2k:high", resolution: "2k", quality: "high", cnyPrice: 4.6},
			{specKey: "image:4k:high", resolution: "4k", quality: "high", cnyPrice: 7.6},
		}
	case "gpt-image-2-official":
		return []fixedImagePricingRule{
			{specKey: "image:1k:low", resolution: "1k", quality: "low", cnyPrice: 0.3},
			{specKey: "image:2k:low", resolution: "2k", quality: "low", cnyPrice: 0.4},
			{specKey: "image:4k:low", resolution: "4k", quality: "low", cnyPrice: 0.5},
			{specKey: "image:1k:medium", resolution: "1k", quality: "medium", cnyPrice: 0.6},
			{specKey: "image:2k:medium", resolution: "2k", quality: "medium", cnyPrice: 1.2},
			{specKey: "image:4k:medium", resolution: "4k", quality: "medium", cnyPrice: 1.9},
			{specKey: "image:1k:high", resolution: "1k", quality: "high", cnyPrice: 2.3},
			{specKey: "image:2k:high", resolution: "2k", quality: "high", cnyPrice: 4.6},
			{specKey: "image:4k:high", resolution: "4k", quality: "high", cnyPrice: 7.6},
		}
	case "gemini-3-pro-image-preview-official":
		return []fixedImagePricingRule{
			{specKey: "image:1k", resolution: "1k", cnyPrice: 1.3},
			{specKey: "image:2k", resolution: "2k", cnyPrice: 1.3},
			{specKey: "image:4k", resolution: "4k", cnyPrice: 2.4},
		}
	default:
		return nil
	}
}

func fixedImageRuleCNY(rule fixedImagePricingRule) float64 {
	return rule.cnyPrice
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

// systemDefaultModelPricingConfig exposes the built-in media price registry
// through the same structured contract used by model-level pricing overrides.
// The management API uses this to show the rule that is actually effective
// instead of presenting an empty form while relay billing still uses it.
func systemDefaultModelPricingConfig(modelName string) *ModelPricingConfig {
	imageRules := fixedImagePricingRules(modelName)
	if len(imageRules) > 0 {
		specs := make([]ModelPricingSpec, 0, len(imageRules))
		for _, rule := range imageRules {
			specKey := strings.TrimSpace(rule.specKey)
			if specKey == "" {
				specKey = imageSpecKey(rule.aspectRatio, rule.resolution, rule.quality)
			}
			specs = append(specs, ModelPricingSpec{
				SpecKey:    specKey,
				Resolution: strings.ToLower(strings.TrimSpace(rule.resolution)),
				PriceCNY:   fixedImageRuleCNY(rule),
			})
		}
		return &ModelPricingConfig{
			Currency:               PricingCurrencyCNY,
			BillingMode:            PricingBillingModeFixedBySpec,
			ReferenceImagePriceCNY: builtInReferenceImagePriceCNY(modelName),
			Specs:                  specs,
		}
	}

	canonicalModel := CanonicalModelKey(modelName)
	if fixedSpecs := fixedVideoPricingSpecs[canonicalModel]; len(fixedSpecs) > 0 {
		specs := make([]ModelPricingSpec, 0, len(fixedSpecs))
		for _, spec := range fixedSpecs {
			specs = append(specs, ModelPricingSpec{
				SpecKey:         fmt.Sprintf("video:%s:%ds", spec.resolution, spec.duration),
				Resolution:      strings.ToLower(strings.TrimSpace(spec.resolution)),
				DurationSeconds: spec.duration,
				PriceCNY:        spec.cnyPrice,
			})
		}
		return &ModelPricingConfig{
			Currency:    PricingCurrencyCNY,
			BillingMode: PricingBillingModeFixedBySpec,
			Specs:       specs,
		}
	}

	linearRules := linearVideoPricingRules[canonicalModel]
	if len(linearRules) == 0 {
		return nil
	}
	specs := make([]ModelPricingSpec, 0, len(linearRules))
	for _, rule := range linearRules {
		specs = append(specs, ModelPricingSpec{
			Resolution:   strings.ToLower(strings.TrimSpace(rule.resolution)),
			CNYPerSecond: rule.cnyPerSecond,
		})
	}
	return &ModelPricingConfig{
		Currency:    PricingCurrencyCNY,
		BillingMode: PricingBillingModeLinearBySpec,
		Specs:       specs,
	}
}

func resolveEffectiveModelPricingConfig(
	modelName string,
	rawPricingConfig string,
) (*ModelPricingConfig, string, error) {
	config, err := ParseModelPricingConfig(rawPricingConfig)
	if err != nil {
		return nil, SpecPricingSourceNone, err
	}
	if config != nil {
		if config.IsDisabled() {
			return nil, SpecPricingSourceDisabled, nil
		}
		return config, SpecPricingSourceModel, nil
	}
	systemDefault := systemDefaultModelPricingConfig(modelName)
	if systemDefault == nil {
		return nil, SpecPricingSourceNone, nil
	}
	return systemDefault, SpecPricingSourceSystemDefault, nil
}

func configuredModelPricingConfigFrom(
	configuredPricing map[string]ModelPricingConfig,
	modelName string,
) (ModelPricingConfig, bool) {
	trimmedModelName := strings.TrimSpace(modelName)
	if config, ok := configuredPricing[trimmedModelName]; ok {
		return config, true
	}
	for _, key := range RoutingModelCandidates(modelName) {
		if key == trimmedModelName {
			continue
		}
		if config, ok := configuredPricing[key]; ok {
			return config, true
		}
	}
	return ModelPricingConfig{}, false
}

func configuredModelPricingConfig(modelName string) (ModelPricingConfig, bool) {
	// Pricing cache publication holds the write side of this lock while it swaps
	// both the public catalog and the billing lookup. This read lock prevents a
	// charge from observing a half-published refresh.
	modelSupportEndpointsLock.RLock()
	defer modelSupportEndpointsLock.RUnlock()
	configuredPricingLock.RLock()
	defer configuredPricingLock.RUnlock()
	return configuredModelPricingConfigFrom(configuredPricingByModel, modelName)
}

// VideoSpecPriceCNY 返回视频模型在 (分辨率 × 时长) 规格下发布的 CNY 价格 ——
// 与 /api/pricing 暴露给下游（画布积分定价）的是同一张规格价表，任务计费按它
// 折算可保证「用户实际花费」与 new-api 台账一致。找不到对应规格时返回 (0, false)。
func VideoSpecPriceCNY(modelName string, resolution string, durationSeconds int) (float64, bool) {
	if durationSeconds <= 0 {
		return 0, false
	}
	res := strings.TrimSpace(strings.ToLower(resolution))
	if res == "" {
		return 0, false
	}
	if config, configured := configuredModelPricingConfig(modelName); configured {
		if price, ok := config.FixedPriceCNY(res, durationSeconds); ok {
			return price, true
		}
		return config.LinearPriceCNY(res, durationSeconds)
	}
	systemDefault := systemDefaultModelPricingConfig(modelName)
	if systemDefault == nil {
		return 0, false
	}
	if price, ok := systemDefault.FixedPriceCNY(res, durationSeconds); ok {
		return price, true
	}
	return systemDefault.LinearPriceCNY(res, durationSeconds)
}

// EffectiveFixedSpecPriceCNY is authoritative: a persisted disabled or partial
// model configuration never falls through to a hidden system-default row.
func EffectiveFixedSpecPriceCNY(modelName, resolution string, durationSeconds int) (float64, bool) {
	if config, configured := configuredModelPricingConfig(modelName); configured {
		return config.FixedPriceCNY(resolution, durationSeconds)
	}
	systemDefault := systemDefaultModelPricingConfig(modelName)
	if systemDefault == nil {
		return 0, false
	}
	return systemDefault.FixedPriceCNY(resolution, durationSeconds)
}

func isGptImage2QualityPricingModel(modelName string) bool {
	canonical := CanonicalModelKey(modelName)
	return canonical == "gpt-image-2" || canonical == "gpt-image-2-official"
}

func builtInReferenceImagePriceCNY(modelName string) float64 {
	if isGptImage2QualityPricingModel(modelName) {
		return 0.1
	}
	if CanonicalModelKey(modelName) == "minimax-h3" {
		return 0.065
	}
	return 0
}

func builtInReferenceImageFreeCount(modelName string) int {
	if CanonicalModelKey(modelName) == "minimax-h3" {
		return 5
	}
	return 0
}

// EffectiveImageReferencePriceCNY publishes and charges the same additive
// per-reference-image price. An explicit model config remains authoritative.
func EffectiveImageReferencePriceCNY(modelName string) float64 {
	if config, configured := configuredModelPricingConfig(modelName); configured {
		return config.ReferenceImagePriceCNY
	}
	return builtInReferenceImagePriceCNY(modelName)
}

// EffectiveImageReferenceFreeCount keeps submission billing aligned with the
// same free-reference allowance published by /api/pricing.
func EffectiveImageReferenceFreeCount(modelName string) int {
	if config, configured := configuredModelPricingConfig(modelName); configured {
		return config.ReferenceImageFreeCount
	}
	return builtInReferenceImageFreeCount(modelName)
}

// NormalizeGptImage2Quality maps the public request vocabulary onto the three
// Tencent premium billing tiers. auto/standard/empty preserve the established
// low-cost default; hd is the long-standing OpenAI alias for high.
func NormalizeGptImage2Quality(quality string) (string, bool) {
	switch strings.ToLower(strings.TrimSpace(quality)) {
	case "", "auto", "standard", "low":
		return "low", true
	case "medium":
		return "medium", true
	case "high", "hd":
		return "high", true
	default:
		return "", false
	}
}

func fixedImageSpecPriceCNY(config ModelPricingConfig, modelName, resolution, quality string) (float64, bool) {
	res := strings.ToLower(strings.TrimSpace(resolution))
	if res == "" {
		return 0, false
	}
	if isGptImage2QualityPricingModel(modelName) {
		normalizedQuality, ok := NormalizeGptImage2Quality(quality)
		if !ok {
			return 0, false
		}
		if price, found := config.FixedPriceCNYBySpecKey(
			fmt.Sprintf("image:%s:%s", res, normalizedQuality),
		); found {
			return price, true
		}
		return 0, false
	}
	if price, found := config.FixedPriceCNYBySpecKey("image:" + res); found {
		return price, true
	}
	return config.FixedPriceCNY(res, 0)
}

// EffectiveFixedImageSpecPriceCNY resolves the exact image selling price used
// by both the public pricing snapshot and post-generation quota accounting.
func EffectiveFixedImageSpecPriceCNY(modelName, resolution, quality string) (float64, bool) {
	if config, configured := configuredModelPricingConfig(modelName); configured {
		return fixedImageSpecPriceCNY(config, modelName, resolution, quality)
	}
	systemDefault := systemDefaultModelPricingConfig(modelName)
	if systemDefault == nil {
		return 0, false
	}
	return fixedImageSpecPriceCNY(*systemDefault, modelName, resolution, quality)
}

// effectivePublishedBasePriceCNY preserves the public model_price contract:
// model-level spec overrides and built-in fixed image tiers may provide a
// per-request base, while a built-in linear video rate must remain exclusively
// in param_pricing because CNY/second is not a per-request price.
func effectivePublishedBasePriceCNY(modelName string) (float64, bool) {
	if config, configured := configuredModelPricingConfig(modelName); configured {
		return config.BasePriceCNY()
	}
	return fixedImageBasePriceCNY(modelName)
}

func effectivePublishedBasePriceCNYFrom(
	configuredPricing map[string]ModelPricingConfig,
	modelName string,
) (float64, bool) {
	if config, configured := configuredModelPricingConfigFrom(configuredPricing, modelName); configured {
		return config.BasePriceCNY()
	}
	return fixedImageBasePriceCNY(modelName)
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
	if config, err := ParseModelPricingConfig(metaPricingConfig(meta)); err == nil && config != nil {
		if config.IsDisabled() {
			return nil
		}
		return buildConfiguredParamPricing(*config, meta)
	}
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
			Currency:               "CNY",
			BillingMode:            "fixed_by_image_spec",
			Formula:                "price_cny = fixed image spec selling price + reference_image_count * reference_image_price_cny",
			ReferenceImagePriceCNY: builtInReferenceImagePriceCNY(modelName),
			Results:                results,
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
	referenceImageFreeCount := builtInReferenceImageFreeCount(modelName)
	referenceImagePriceCNY := builtInReferenceImagePriceCNY(modelName)
	formula := strings.Join(formulaLines, "; ")
	if referenceImagePriceCNY > 0 {
		formula = strings.Join(append(formulaLines, "reference images above the free allowance are additive"), "; ")
	}
	return &ParamPricing{
		Currency:                "CNY",
		BillingMode:             "linear_by_duration_and_resolution",
		Formula:                 formula,
		ReferenceImageFreeCount: referenceImageFreeCount,
		ReferenceImagePriceCNY:  referenceImagePriceCNY,
		Results:                 results,
	}
}

func metaPricingConfig(meta *Model) string {
	if meta == nil {
		return ""
	}
	return meta.PricingConfig
}

func buildConfiguredParamPricing(config ModelPricingConfig, meta *Model) *ParamPricing {
	if config.IsDisabled() {
		return nil
	}
	results := make([]ParamPricingResult, 0, len(config.Specs))
	if config.BillingMode == PricingBillingModeFixedBySpec {
		for _, spec := range config.Specs {
			specKey := strings.TrimSpace(spec.SpecKey)
			if specKey == "" {
				if spec.DurationSeconds > 0 {
					specKey = fmt.Sprintf("video:%s:%ds", spec.Resolution, spec.DurationSeconds)
				} else {
					specKey = fmt.Sprintf("image:%s", spec.Resolution)
				}
			}
			results = append(results, ParamPricingResult{SpecKey: specKey, Resolution: strings.ToLower(strings.TrimSpace(spec.Resolution)), DurationSeconds: spec.DurationSeconds, PriceCNY: spec.PriceCNY, PriceDisplayCNY: formatCNY(spec.PriceCNY)})
		}
		return &ParamPricing{Currency: PricingCurrencyCNY, BillingMode: PricingBillingModeFixedBySpec, Formula: "price_cny = configured fixed spec price + max(reference_image_count - reference_image_free_count, 0) * reference_image_price_cny", ReferenceImageFreeCount: config.ReferenceImageFreeCount, ReferenceImagePriceCNY: config.ReferenceImagePriceCNY, Results: results}
	}
	durations := extractDurationOptions(meta)
	if len(durations) == 0 {
		return nil
	}
	results = make([]ParamPricingResult, 0, len(config.Specs)*len(durations))
	formulaLines := make([]string, 0, len(config.Specs))
	for _, spec := range config.Specs {
		formulaLines = append(formulaLines, fmt.Sprintf("%s: price_cny = duration_seconds * %.6f", spec.Resolution, spec.CNYPerSecond))
		for _, duration := range durations {
			price := spec.CNYPerSecond * float64(duration)
			results = append(results, ParamPricingResult{SpecKey: fmt.Sprintf("video:%s:%ds", spec.Resolution, duration), Resolution: strings.ToLower(strings.TrimSpace(spec.Resolution)), DurationSeconds: duration, PriceCNY: price, PriceDisplayCNY: formatCNY(price)})
		}
	}
	return &ParamPricing{Currency: PricingCurrencyCNY, BillingMode: PricingBillingModeLinearBySpec, Formula: strings.Join(formulaLines, "; "), Results: results}
}

// maxChannelPriceRatioByCanonicalModel 计算每个 canonical 模型在所有启用渠道中的
// 最高渠道价格倍率（channels.setting.price_ratio，缺省=1.0）。发布价按最贵渠道定价，
// 保证下游（画布积分）扣费足以覆盖任一实际路由到的渠道成本。
func maxChannelPriceRatioByCanonicalModel(abilities []AbilityWithChannel) map[string]float64 {
	settingRatioCache := make(map[string]float64)
	parseRatio := func(settingJSON string) float64 {
		if strings.TrimSpace(settingJSON) == "" {
			return 1.0
		}
		if v, ok := settingRatioCache[settingJSON]; ok {
			return v
		}
		ratio := 1.0
		var setting dto.ChannelSettings
		if err := common.Unmarshal([]byte(settingJSON), &setting); err == nil {
			ratio = setting.GetPriceRatio()
		}
		settingRatioCache[settingJSON] = ratio
		return ratio
	}
	out := make(map[string]float64)
	for _, ability := range abilities {
		canonical := CanonicalModelKey(ability.Model)
		if canonical == "" {
			continue
		}
		ratio := parseRatio(ability.ChannelSetting)
		if existing, ok := out[canonical]; !ok || ratio > existing {
			out[canonical] = ratio
		}
	}
	return out
}

func maxChannelVideoPriceFloorByCanonicalModel(abilities []AbilityWithChannel) map[string]float64 {
	out := make(map[string]float64)
	for _, ability := range abilities {
		canonical := CanonicalModelKey(ability.Model)
		if canonical == "" || strings.TrimSpace(ability.ChannelSetting) == "" {
			continue
		}
		var settings dto.ChannelSettings
		if err := common.Unmarshal([]byte(ability.ChannelSetting), &settings); err != nil {
			continue
		}
		floor := settings.GetMinVideoPriceCNYPerSecond()
		if existing, ok := out[canonical]; !ok || floor > existing {
			out[canonical] = floor
		}
	}
	return out
}

// pricingModelReferenceByCanonicalModel separates the public catalog identity
// from its live price source. Every enabled channel for the same public model
// must resolve to the same source; conflicting contracts fail the snapshot
// refresh instead of publishing an arbitrary price.
func pricingModelReferenceByCanonicalModel(abilities []AbilityWithChannel) (map[string]string, error) {
	out := make(map[string]string)
	for _, ability := range abilities {
		publicModel := CanonicalModelKey(ability.Model)
		if publicModel == "" {
			continue
		}
		settings := dto.ChannelSettings{}
		if strings.TrimSpace(ability.ChannelSetting) != "" {
			if err := common.Unmarshal([]byte(ability.ChannelSetting), &settings); err != nil {
				return nil, fmt.Errorf(
					"channel %d model %s has invalid pricing settings: %w",
					ability.ChannelId,
					ability.Model,
					err,
				)
			}
		}
		priceSource, err := settings.ResolvePricingModelName(ability.Model)
		if err != nil {
			return nil, fmt.Errorf(
				"channel %d model %s has invalid pricing model reference: %w",
				ability.ChannelId,
				ability.Model,
				err,
			)
		}
		canonicalSource := CanonicalModelKey(priceSource)
		if canonicalSource == "" {
			return nil, fmt.Errorf(
				"channel %d model %s resolved an empty pricing model reference",
				ability.ChannelId,
				ability.Model,
			)
		}
		if existing, configured := out[publicModel]; configured && existing != canonicalSource {
			return nil, fmt.Errorf(
				"public model %s has conflicting pricing sources %s and %s",
				publicModel,
				existing,
				canonicalSource,
			)
		}
		out[publicModel] = canonicalSource
	}
	return out, nil
}

// applyChannelPriceRatioToPricing 把渠道最高价格倍率应用到发布价：
// param_pricing 每个规格的 CNY 价与固定按次 ModelPrice 同步放大。
// token 倍率（ModelRatio）不放大 —— token 计费的渠道倍率在结算时相乘。
func applyChannelPricingContractToPricing(p *Pricing, ratio, minVideoPriceCNYPerSecond float64) {
	if ratio <= 0 {
		return
	}
	if p.QuotaType == 1 && p.ModelPrice > 0 {
		p.ModelPrice *= ratio
	}
	if p.ParamPricing != nil {
		if ratio != 1.0 || minVideoPriceCNYPerSecond > 0 {
			ratioFormula := fmt.Sprintf("discounted_price_cny = source_price_cny * %.6f", ratio)
			if minVideoPriceCNYPerSecond > 0 {
				ratioFormula += fmt.Sprintf(
					"; published_price_cny = max(discounted_price_cny, duration_seconds * %.6f)",
					minVideoPriceCNYPerSecond,
				)
			} else {
				ratioFormula += "; published_price_cny = discounted_price_cny"
			}
			if sourceFormula := strings.TrimSpace(p.ParamPricing.Formula); sourceFormula != "" {
				ratioFormula += "; source formula: " + sourceFormula
			}
			p.ParamPricing.Formula = ratioFormula
		}
		if p.ParamPricing.ReferenceImagePriceCNY > 0 {
			p.ParamPricing.ReferenceImagePriceCNY *= ratio
		}
		for i := range p.ParamPricing.Results {
			if p.ParamPricing.Results[i].PriceCNY > 0 {
				p.ParamPricing.Results[i].PriceCNY *= ratio
				if p.ParamPricing.Results[i].DurationSeconds > 0 && minVideoPriceCNYPerSecond > 0 {
					floorPrice := float64(p.ParamPricing.Results[i].DurationSeconds) * minVideoPriceCNYPerSecond
					if floorPrice > p.ParamPricing.Results[i].PriceCNY {
						p.ParamPricing.Results[i].PriceCNY = floorPrice
					}
				}
				p.ParamPricing.Results[i].PriceDisplayCNY = formatCNY(p.ParamPricing.Results[i].PriceCNY)
			}
		}
		if minVideoPriceCNYPerSecond > 0 {
			minPublishedSpecPrice := 0.0
			for _, result := range p.ParamPricing.Results {
				if result.PriceCNY > 0 && (minPublishedSpecPrice == 0 || result.PriceCNY < minPublishedSpecPrice) {
					minPublishedSpecPrice = result.PriceCNY
				}
			}
			if minPublishedSpecPrice > 0 {
				p.ModelPrice = minPublishedSpecPrice
				p.QuotaType = 1
			}
		}
	}
}

func resolveAbilityEndpointTypes(ability AbilityWithChannel) ([]string, error) {
	if strings.TrimSpace(ability.ChannelSetting) == "" {
		return nil, fmt.Errorf(
			"channel %d model %q has no explicit protocol setting",
			ability.ChannelId,
			ability.Model,
		)
	}

	var settings dto.ChannelSettings
	if err := common.Unmarshal([]byte(ability.ChannelSetting), &settings); err != nil {
		return nil, fmt.Errorf(
			"channel %d model %q has invalid setting: %w",
			ability.ChannelId,
			ability.Model,
			err,
		)
	}
	resolvedProtocol, err := ResolveProtocolBinding(settings, ability.Model)
	if err != nil {
		return nil, fmt.Errorf(
			"channel %d model %q has invalid protocol binding: %w",
			ability.ChannelId,
			ability.Model,
			err,
		)
	}

	endpointTypes := make([]string, 0, len(resolvedProtocol.Protocol.EndpointTypes))
	for _, endpointType := range resolvedProtocol.Protocol.EndpointTypes {
		endpointTypes = append(endpointTypes, string(endpointType))
	}
	return endpointTypes, nil
}

func updatePricing() error {
	//modelRatios := common.GetModelRatios()
	enableAbilities, err := GetAllEnableAbilityWithChannels()
	if err != nil {
		return fmt.Errorf("读取可用模型渠道失败: %w", err)
	}
	maxChannelPriceRatio := maxChannelPriceRatioByCanonicalModel(enableAbilities)
	maxChannelVideoPriceFloor := maxChannelVideoPriceFloorByCanonicalModel(enableAbilities)
	pricingModelReference, err := pricingModelReferenceByCanonicalModel(enableAbilities)
	if err != nil {
		return fmt.Errorf("解析模型计价引用失败: %w", err)
	}
	// 预加载模型元数据与供应商一次，避免循环查询
	var allMeta []Model
	if err := DB.Find(&allMeta).Error; err != nil {
		return fmt.Errorf("读取模型元数据失败: %w", err)
	}
	for index := range allMeta {
		meta := &allMeta[index]
		if _, err := ParseModelPricingConfig(meta.PricingConfig); err != nil {
			return fmt.Errorf(
				"模型 %d(%s) 的定价配置无效: %w",
				meta.Id,
				meta.ModelName,
				err,
			)
		}
	}
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
	if err := DB.Find(&vendors).Error; err != nil {
		return fmt.Errorf("读取模型供应商失败: %w", err)
	}
	vendorMap := make(map[int]*Vendor)
	for i := range vendors {
		vendorMap[vendors[i].Id] = &vendors[i]
	}

	// 初始化默认供应商映射
	initDefaultVendorMapping(metaMap, vendorMap, enableAbilities)

	// 构建对前端友好的供应商列表。刷新完整校验通过前只写局部状态。
	nextVendorsList := make([]PricingVendor, 0, len(vendorMap))
	for _, v := range vendorMap {
		nextVendorsList = append(nextVendorsList, PricingVendor{
			ID:          v.Id,
			Name:        v.Name,
			Description: v.Description,
			Icon:        v.Icon,
		})
	}
	sort.Slice(nextVendorsList, func(left, right int) bool {
		return nextVendorsList[left].ID < nextVendorsList[right].ID
	})

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
	configuredPricing := make(map[string]ModelPricingConfig)
	for index := range allMeta {
		meta := &allMeta[index]
		if meta.NameRule != NameRuleExact {
			continue
		}
		config, err := ParseModelPricingConfig(meta.PricingConfig)
		if err != nil || config == nil {
			continue
		}
		configuredPricing[meta.ModelName] = *config
	}
	for canonicalModel, meta := range canonicalMetaMap {
		config, err := ParseModelPricingConfig(meta.PricingConfig)
		if err != nil || config == nil {
			continue
		}
		configuredPricing[canonicalModel] = *config
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
		resolvedEndpointTypes, err := resolveAbilityEndpointTypes(ability)
		if err != nil {
			common.SysLog(fmt.Sprintf(
				"Warning: skip endpoint publication for channel %d model %q: %v",
				ability.ChannelId,
				ability.Model,
				err,
			))
			continue
		}
		for _, endpointType := range resolvedEndpointTypes {
			if !common.StringsContains(endpoints, endpointType) {
				endpoints = append(endpoints, endpointType)
			}
		}
		modelSupportEndpointsStr[canonicalModel] = endpoints
	}

	canonicalModelNames := make([]string, 0, len(canonicalMetaMap))
	for modelName := range canonicalMetaMap {
		canonicalModelNames = append(canonicalModelNames, modelName)
	}
	sort.Strings(canonicalModelNames)

	// 再补充 object-form 模型自定义端点：有效配置替换渠道端点，不做合并。
	// 旧版数组/纯字符串配置继续由渠道协议目录提供端点类型。
	modelEndpointOverrides := make(map[string]map[string]common.EndpointInfo)
	for _, modelName := range canonicalModelNames {
		meta := canonicalMetaMap[modelName]
		overrides, objectForm, err := parseModelEndpointOverrides(meta.Endpoints)
		if err != nil {
			common.SysLog(fmt.Sprintf(
				"Warning: ignore invalid endpoint override for model %q: %v",
				modelName,
				err,
			))
			continue
		}
		if !objectForm {
			continue
		}
		modelEndpointOverrides[modelName] = overrides
		if len(overrides) == 0 {
			continue
		}
		endpoints := make([]string, 0, len(overrides))
		for endpointType := range overrides {
			endpoints = append(endpoints, endpointType)
		}
		sort.Strings(endpoints)
		modelSupportEndpointsStr[modelName] = endpoints
	}

	nextModelSupportEndpointTypes := make(map[string][]constant.EndpointType)
	for model, endpoints := range modelSupportEndpointsStr {
		supportedEndpoints := make([]constant.EndpointType, 0)
		for _, endpointStr := range endpoints {
			endpointType := constant.EndpointType(endpointStr)
			supportedEndpoints = append(supportedEndpoints, endpointType)
		}
		nextModelSupportEndpointTypes[model] = supportedEndpoints
	}
	for _, modelName := range canonicalModelNames {
		meta := canonicalMetaMap[modelName]
		if strings.EqualFold(strings.TrimSpace(meta.Kind), "audio") {
			nextModelSupportEndpointTypes[modelName] = []constant.EndpointType{
				constant.EndpointTypeAudioSpeech,
			}
		}
	}

	nextPricingMap := make([]Pricing, 0)
	for model, groups := range modelGroupsMap {
		supportedEndpointTypes := nextModelSupportEndpointTypes[model]
		if len(supportedEndpointTypes) == 0 {
			common.SysLog(fmt.Sprintf(
				"Warning: exclude model %q from pricing catalog because no valid endpoint was resolved",
				model,
			))
			continue
		}
		pricingModel := model
		if referencedModel, ok := pricingModelReference[model]; ok {
			pricingModel = referencedModel
		}
		pricing := Pricing{
			ModelName:              model,
			EnableGroup:            groups.Items(),
			SupportedEndpointTypes: supportedEndpointTypes,
		}

		// 补充模型元数据（描述、标签、供应商、状态）
		if meta, ok := canonicalMetaMap[model]; ok {
			// 若模型被禁用(status!=1)，则直接跳过，不返回给前端
			if meta.Status != 1 {
				continue
			}
			pricing.Description = meta.Description
			pricing.ModelKind = strings.TrimSpace(meta.Kind)
			pricing.Icon = meta.Icon
			pricing.Tags = meta.Tags
			pricing.VendorID = meta.VendorID
			pricing.ParamPricing = buildParamPricing(pricingModel, meta)
		}
		if _, hasMeta := canonicalMetaMap[model]; !hasMeta && pricing.ParamPricing == nil {
			pricing.ParamPricing = buildParamPricing(pricingModel, nil)
		}
		modelPrice, findPrice := effectivePublishedBasePriceCNYFrom(configuredPricing, pricingModel)
		if !findPrice {
			modelPrice, findPrice = findCanonicalModelPrice(pricingModel)
		}
		if findPrice {
			pricing.ModelPrice = modelPrice
			pricing.QuotaType = 1
		} else {
			modelRatio, completionRatio := findCanonicalModelRatio(pricingModel)
			pricing.ModelRatio = modelRatio
			pricing.CompletionRatio = completionRatio
			pricing.QuotaType = 0
		}
		if cacheRatio, ok := findCanonicalCacheRatio(pricingModel); ok {
			pricing.CacheRatio = &cacheRatio
		}
		if createCacheRatio, ok := findCanonicalCreateCacheRatio(pricingModel); ok {
			pricing.CreateCacheRatio = &createCacheRatio
		}
		if imageRatio, ok := findCanonicalImageRatio(pricingModel); ok {
			pricing.ImageRatio = &imageRatio
		}
		if audioRatio, ok := findCanonicalAudioRatio(pricingModel); ok {
			pricing.AudioRatio = &audioRatio
		}
		if audioCompletionRatio, ok := findCanonicalAudioCompletionRatio(pricingModel); ok {
			pricing.AudioCompletionRatio = &audioCompletionRatio
		}
		// 渠道价格倍率：发布价取该模型所有启用渠道中的最高倍率
		//（channels.setting.price_ratio），保证下游（画布积分）按最贵渠道定价。
		channelRatio := maxChannelPriceRatio[model]
		if channelRatio <= 0 {
			channelRatio = 1.0
		}
		videoPriceFloor := maxChannelVideoPriceFloor[model]
		if channelRatio != 1.0 || videoPriceFloor > 0 {
			applyChannelPricingContractToPricing(&pricing, channelRatio, videoPriceFloor)
		}
		nextPricingMap = append(nextPricingMap, pricing)
	}

	endpointContracts := make([]modelEndpointContract, 0, len(nextPricingMap))
	for _, pricing := range nextPricingMap {
		endpointContracts = append(endpointContracts, modelEndpointContract{
			ModelName:     pricing.ModelName,
			EndpointTypes: pricing.SupportedEndpointTypes,
			Overrides:     modelEndpointOverrides[pricing.ModelName],
		})
	}
	nextSupportedEndpointMap, err := buildSupportedEndpointCatalog(endpointContracts)
	if err != nil {
		return fmt.Errorf("构建公开端点目录失败: %w", err)
	}

	// 防止大更新后数据不通用
	if len(nextPricingMap) > 0 {
		nextPricingMap[0].PricingVersion = "5a90f2b86c08bd983a9a2e6d66c255f4eaef9c4bc934386d2b6ae84ef0ff1f1f"
	}

	nextModelEnableGroups := make(map[string][]string, len(nextPricingMap))
	nextModelQuotaTypeMap := make(map[string]int, len(nextPricingMap))
	nextModelKindMap := make(map[string]string, len(allMeta))
	for _, pricing := range nextPricingMap {
		nextModelEnableGroups[pricing.ModelName] = pricing.EnableGroup
		nextModelQuotaTypeMap[pricing.ModelName] = pricing.QuotaType
	}
	for index := range allMeta {
		meta := &allMeta[index]
		if meta.Kind != "" {
			nextModelKindMap[meta.ModelName] = meta.Kind
		}
	}

	// All fallible work is complete. Publish every pricing-related cache while
	// the caller still holds modelSupportEndpointsLock's write side. Billing
	// and derived-map readers use the same publication barrier.
	configuredPricingLock.Lock()
	modelEnableGroupsLock.Lock()
	pricingMap = nextPricingMap
	vendorsList = nextVendorsList
	supportedEndpointMap = nextSupportedEndpointMap
	modelSupportEndpointTypes = nextModelSupportEndpointTypes
	configuredPricingByModel = configuredPricing
	modelEnableGroups = nextModelEnableGroups
	modelQuotaTypeMap = nextModelQuotaTypeMap
	modelKindMap = nextModelKindMap
	lastGetPricingTime = time.Now()
	modelEnableGroupsLock.Unlock()
	configuredPricingLock.Unlock()
	return nil
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
