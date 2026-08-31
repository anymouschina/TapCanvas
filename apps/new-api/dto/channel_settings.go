package dto

import (
	"fmt"
	"net/url"
	"regexp"
	"strings"
)

var aiStudioImporterPasswordEnvPattern = regexp.MustCompile(`^[A-Z_][A-Z0-9_]{0,127}$`)

// ProtocolBinding selects an upstream wire protocol independently from the
// commercial channel type. Options are protocol-scoped facts (for example an
// explicit API version); provider credentials and connection settings remain
// on the channel itself.
type ProtocolBinding struct {
	Protocol string            `json:"protocol"`
	Options  map[string]string `json:"options,omitempty"`
}

type ChannelSettings struct {
	ForceFormat            bool   `json:"force_format,omitempty"`
	ThinkingToContent      bool   `json:"thinking_to_content,omitempty"`
	Proxy                  string `json:"proxy"`
	PassThroughBodyEnabled bool   `json:"pass_through_body_enabled,omitempty"`
	SystemPrompt           string `json:"system_prompt,omitempty"`
	SystemPromptOverride   bool   `json:"system_prompt_override,omitempty"`
	// OAuthKeyConcurrency 限制该渠道内「每个 OAuth 账号(每个 key)」的在飞并发请求数。
	// 当前适用于 Claude/Gemini OAuth 多账号渠道；0 = 不限制。
	OAuthKeyConcurrency int `json:"oauth_key_concurrency,omitempty"`
	// OAuthKeyCooldownSeconds 是账号触发上游 429 限额后的冷却时长(秒)。适用于
	// Claude/Gemini OAuth 多账号渠道。-1 = 关闭专属冷却;0 = 使用 provider 默认值;
	// >0 = 自定义兜底秒数。
	OAuthKeyCooldownSeconds int `json:"oauth_key_cooldown_seconds,omitempty"`
	// PriceRatio 渠道价格倍率：该渠道采购价相对基准价的倍数，计费时在现有价格上
	// 额外乘以此倍率（任务计费落到 OtherRatios["channel_price"]，文本/图片计费在最终
	// 额度上相乘）。/api/pricing 发布价取「同一模型所有启用渠道中的最高倍率」，保证
	// 下游（画布积分）按最贵渠道定价。0/缺省 = 1.0（不调整）。
	PriceRatio float64 `json:"price_ratio,omitempty"`
	// MinVideoPriceCNYPerSecond is a deterministic selling-price floor for
	// duration-based video tasks. It is applied after PriceRatio so a discount
	// cannot publish or charge less than the configured per-second cost floor.
	MinVideoPriceCNYPerSecond float64 `json:"min_video_price_cny_per_second,omitempty"`
	// CodexUseWorker selects the explicit ChatGPT network exit for Codex API and
	// WHAM usage requests. false uses official chatgpt.com; true uses the
	// operator-managed Cloudflare Worker. There is no implicit failover.
	CodexUseWorker bool `json:"codex_use_worker,omitempty"`
	// VertexEgressIsolationEnabled switches Vertex AI traffic between the
	// official direct path and an operator-managed Dedicated Egress pool.
	// When enabled, both OAuth token exchange and model requests must use the
	// selected cell. Runtime failures never fall back to a direct connection.
	VertexEgressIsolationEnabled bool               `json:"vertex_egress_isolation_enabled,omitempty"`
	VertexEgressCells            []VertexEgressCell `json:"vertex_egress_cells,omitempty"`
	// DefaultProtocol is the explicit protocol used by every model on this
	// channel unless ModelProtocols contains a model-specific override.
	DefaultProtocol *ProtocolBinding `json:"default_protocol,omitempty"`
	// ModelProtocols lets one commercial channel expose different upstream
	// protocols for different models without duplicating the channel.
	ModelProtocols map[string]ProtocolBinding `json:"model_protocols,omitempty"`
	// PricingModelMapping lets a public channel-specific model reuse another
	// model's live price source without collapsing their catalog identities or
	// copying an absolute price table. The channel PriceRatio is applied after
	// this reference is resolved.
	PricingModelMapping map[string]string `json:"pricing_model_mapping,omitempty"`
	// AIStudioImporterURL is the management endpoint for the browser-backed
	// aistudio-to-api runtime. The Google storageState is forwarded directly to
	// this endpoint and is never persisted in the new-api database.
	AIStudioImporterURL string `json:"aistudio_importer_url,omitempty"`
	// AIStudioImporterUsername is safe to persist. The Basic Auth password is
	// intentionally referenced by environment-variable name instead of being
	// stored in channel settings.
	AIStudioImporterUsername    string `json:"aistudio_importer_username,omitempty"`
	AIStudioImporterPasswordEnv string `json:"aistudio_importer_password_env,omitempty"`
}

// ValidateAIStudioImporter validates the deterministic management-plane
// configuration. Remote availability and credentials are checked only when an
// administrator lists or imports accounts, so channel editing never performs
// a hidden network request.
func (s ChannelSettings) ValidateAIStudioImporter() error {
	importerURL := strings.TrimSpace(s.AIStudioImporterURL)
	if importerURL == "" {
		return fmt.Errorf("AI Studio Importer URL 不能为空")
	}
	parsedURL, err := url.Parse(importerURL)
	if err != nil {
		return fmt.Errorf("AI Studio Importer URL 无效: %w", err)
	}
	if parsedURL.Scheme != "https" {
		return fmt.Errorf("AI Studio Importer URL 必须使用 https")
	}
	if parsedURL.Host == "" {
		return fmt.Errorf("AI Studio Importer URL 缺少主机")
	}
	if parsedURL.RawQuery != "" || parsedURL.Fragment != "" {
		return fmt.Errorf("AI Studio Importer URL 不能包含 query 或 fragment")
	}
	if strings.TrimSpace(s.AIStudioImporterUsername) == "" {
		return fmt.Errorf("AI Studio Importer 用户名不能为空")
	}
	passwordEnv := strings.TrimSpace(s.AIStudioImporterPasswordEnv)
	if !aiStudioImporterPasswordEnvPattern.MatchString(passwordEnv) {
		return fmt.Errorf("AI Studio Importer 密码环境变量名无效")
	}
	return nil
}

type VertexEgressCell struct {
	ID       string `json:"id"`
	ProxyURL string `json:"proxy_url"`
}

func (s ChannelSettings) ValidateVertexEgress() error {
	if !s.VertexEgressIsolationEnabled {
		return nil
	}
	if len(s.VertexEgressCells) == 0 {
		return fmt.Errorf("Vertex Dedicated Egress 隔离已开启，但未配置出口单元")
	}

	seenIDs := make(map[string]struct{}, len(s.VertexEgressCells))
	for index, cell := range s.VertexEgressCells {
		cellID := strings.TrimSpace(cell.ID)
		if cellID == "" {
			return fmt.Errorf("Vertex Dedicated Egress 出口单元 %d 缺少 ID", index+1)
		}
		if _, exists := seenIDs[cellID]; exists {
			return fmt.Errorf("Vertex Dedicated Egress 出口 ID 重复: %s", cellID)
		}
		seenIDs[cellID] = struct{}{}

		proxyURL := strings.TrimSpace(cell.ProxyURL)
		if proxyURL == "" {
			return fmt.Errorf("Vertex Dedicated Egress 出口 %s 缺少代理地址", cellID)
		}
		parsedURL, err := url.Parse(proxyURL)
		if err != nil {
			return fmt.Errorf("Vertex Dedicated Egress 出口 %s 代理地址无效: %w", cellID, err)
		}
		switch strings.ToLower(parsedURL.Scheme) {
		case "http", "https", "socks5", "socks5h":
		default:
			return fmt.Errorf("Vertex Dedicated Egress 出口 %s 代理协议必须是 http、https、socks5 或 socks5h", cellID)
		}
		if strings.TrimSpace(parsedURL.Host) == "" {
			return fmt.Errorf("Vertex Dedicated Egress 出口 %s 代理地址缺少主机", cellID)
		}
	}
	return nil
}

// GetPriceRatio 返回归一化的渠道价格倍率：未配置（<=0）时为 1.0。
func (s ChannelSettings) GetPriceRatio() float64 {
	if s.PriceRatio <= 0 {
		return 1.0
	}
	return s.PriceRatio
}

func (s ChannelSettings) GetMinVideoPriceCNYPerSecond() float64 {
	if s.MinVideoPriceCNYPerSecond <= 0 {
		return 0
	}
	return s.MinVideoPriceCNYPerSecond
}

// ResolvePricingModelName resolves a one-hop price-source reference for the
// exact public model name. Missing entries intentionally keep identity. An
// explicitly configured blank target is invalid and must fail visibly.
func (s ChannelSettings) ResolvePricingModelName(modelName string) (string, error) {
	publicModel := strings.TrimSpace(modelName)
	if publicModel == "" {
		return "", fmt.Errorf("pricing model name is empty")
	}
	priceSource, configured := s.PricingModelMapping[publicModel]
	if !configured {
		return publicModel, nil
	}
	priceSource = strings.TrimSpace(priceSource)
	if priceSource == "" {
		return "", fmt.Errorf("pricing_model_mapping[%q] is empty", publicModel)
	}
	if _, chained := s.PricingModelMapping[priceSource]; chained && priceSource != publicModel {
		return "", fmt.Errorf(
			"pricing_model_mapping[%q] points to another mapped model %q; only one-hop references are allowed",
			publicModel,
			priceSource,
		)
	}
	return priceSource, nil
}

type VertexKeyType string

const (
	VertexKeyTypeJSON   VertexKeyType = "json"
	VertexKeyTypeAPIKey VertexKeyType = "api_key"
)

type AwsKeyType string

const (
	AwsKeyTypeAKSK   AwsKeyType = "ak_sk" // 默认
	AwsKeyTypeApiKey AwsKeyType = "api_key"
)

type ChannelOtherSettings struct {
	AzureResponsesVersion                 string        `json:"azure_responses_version,omitempty"`
	VertexKeyType                         VertexKeyType `json:"vertex_key_type,omitempty"` // "json" or "api_key"
	OpenRouterEnterprise                  *bool         `json:"openrouter_enterprise,omitempty"`
	ClaudeBetaQuery                       bool          `json:"claude_beta_query,omitempty"`            // Claude 渠道是否强制追加 ?beta=true
	ClaudeImageURLPassThrough             bool          `json:"claude_image_url_passthrough,omitempty"` // 图片以 http(s) URL 直通给上游（type:url），不下载转 base64。仅在上游能抓取该 URL（直连 Anthropic / right.codes，且图为公网直链）时开启；AWS Bedrock / Vertex 不支持，勿开。
	AllowServiceTier                      bool          `json:"allow_service_tier,omitempty"`           // 是否允许 service_tier 透传（默认过滤以避免额外计费）
	AllowInferenceGeo                     bool          `json:"allow_inference_geo,omitempty"`          // 是否允许 inference_geo 透传（仅 Claude，默认过滤以满足数据驻留合规
	AllowSpeed                            bool          `json:"allow_speed,omitempty"`                  // 是否允许 speed 透传（仅 Claude，默认过滤以避免意外切换推理速度模式）
	AllowSafetyIdentifier                 bool          `json:"allow_safety_identifier,omitempty"`      // 是否允许 safety_identifier 透传（默认过滤以保护用户隐私）
	DisableStore                          bool          `json:"disable_store,omitempty"`                // 是否禁用 store 透传（默认允许透传，禁用后可能导致 Codex 无法使用）
	AllowIncludeObfuscation               bool          `json:"allow_include_obfuscation,omitempty"`    // 是否允许 stream_options.include_obfuscation 透传（默认过滤以避免关闭流混淆保护）
	AwsKeyType                            AwsKeyType    `json:"aws_key_type,omitempty"`
	UpstreamModelUpdateCheckEnabled       bool          `json:"upstream_model_update_check_enabled,omitempty"`        // 是否检测上游模型更新
	UpstreamModelUpdateAutoSyncEnabled    bool          `json:"upstream_model_update_auto_sync_enabled,omitempty"`    // 是否自动同步上游模型更新
	UpstreamModelUpdateLastCheckTime      int64         `json:"upstream_model_update_last_check_time,omitempty"`      // 上次检测时间
	UpstreamModelUpdateLastDetectedModels []string      `json:"upstream_model_update_last_detected_models,omitempty"` // 上次检测到的可加入模型
	UpstreamModelUpdateLastRemovedModels  []string      `json:"upstream_model_update_last_removed_models,omitempty"`  // 上次检测到的可删除模型
	UpstreamModelUpdateIgnoredModels      []string      `json:"upstream_model_update_ignored_models,omitempty"`       // 手动忽略的模型
}

func (s *ChannelOtherSettings) IsOpenRouterEnterprise() bool {
	if s == nil || s.OpenRouterEnterprise == nil {
		return false
	}
	return *s.OpenRouterEnterprise
}
