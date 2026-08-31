package model_setting

import (
	"net/http"
	"strings"

	"github.com/QuantumNous/new-api/setting/config"
)

//var claudeHeadersSettings = map[string][]string{}
//
//var ClaudeThinkingAdapterEnabled = true
//var ClaudeThinkingAdapterMaxTokens = 8192
//var ClaudeThinkingAdapterBudgetTokensPercentage = 0.8

// ClaudeSettings 定义Claude模型的配置
type ClaudeSettings struct {
	HeadersSettings                       map[string]map[string][]string `json:"model_headers_settings"`
	DefaultMaxTokens                      map[string]int                 `json:"default_max_tokens"`
	ThinkingAdapterEnabled                bool                           `json:"thinking_adapter_enabled"`
	ThinkingAdapterBudgetTokensPercentage float64                        `json:"thinking_adapter_budget_tokens_percentage"`
}

// 默认配置
var defaultClaudeSettings = ClaudeSettings{
	HeadersSettings:        map[string]map[string][]string{},
	ThinkingAdapterEnabled: true,
	DefaultMaxTokens: map[string]int{
		"default": 8192,
	},
	ThinkingAdapterBudgetTokensPercentage: 0.8,
}

// 全局实例
var claudeSettings = defaultClaudeSettings

func init() {
	// 注册到全局配置管理器
	config.GlobalConfig.Register("claude", &claudeSettings)
}

// GetClaudeSettings 获取Claude配置
func GetClaudeSettings() *ClaudeSettings {
	// check default max tokens must have default key
	if _, ok := claudeSettings.DefaultMaxTokens["default"]; !ok {
		claudeSettings.DefaultMaxTokens["default"] = 8192
	}
	return &claudeSettings
}

func (c *ClaudeSettings) WriteHeaders(originModel string, httpHeader *http.Header) {
	if headers, ok := c.HeadersSettings[originModel]; ok {
		for headerKey, headerValues := range headers {
			mergedValues := normalizeHeaderListValues(
				append(append([]string(nil), httpHeader.Values(headerKey)...), headerValues...),
			)
			if len(mergedValues) == 0 {
				continue
			}
			httpHeader.Set(headerKey, strings.Join(mergedValues, ","))
		}
	}
}

func normalizeHeaderListValues(values []string) []string {
	normalizedValues := make([]string, 0, len(values))
	seenValues := make(map[string]struct{}, len(values))
	for _, value := range values {
		for _, item := range strings.Split(value, ",") {
			normalizedItem := strings.TrimSpace(item)
			if normalizedItem == "" {
				continue
			}
			if _, exists := seenValues[normalizedItem]; exists {
				continue
			}
			seenValues[normalizedItem] = struct{}{}
			normalizedValues = append(normalizedValues, normalizedItem)
		}
	}
	return normalizedValues
}

func (c *ClaudeSettings) GetDefaultMaxTokens(model string) int {
	if maxTokens, ok := c.DefaultMaxTokens[model]; ok {
		return maxTokens
	}
	// 现代 Opus（4.6/4.7/4.8，128K 输出）与 Sonnet 4.6（64K 输出）：客户端（如 agents-cli）
	// 不传 max_tokens 时，旧默认 8192 太小：adaptive thinking + 大型 agentic 工具调用 JSON（如
	// 30 镜 storyPlan、nodes 数组）共享同一预算，超出即把 tool_use 参数 JSON 截断 → "工具参数
	// 不是合法 JSON"。
	//
	// 【2026-07-03 根治整章 storyPlan 截断死循环】32768 仍不够：13 段完整八段镜头表 storyPlan
	// (~2-2.5K token/段 × 13 + thinking) 实测稳定撞 32768 → 每次输出满 32768 被截成无效 JSON →
	// agent 重试 → 又满 32768，10 次全 32768/~9min，烧 ~380 万 quota 也落不了地（ch3《说谎》实测）。
	// 抬到各模型输出硬上限的安全头寸：给足空间让整章 storyPlan 一次完整吐出。流式按实际产出计费，
	// 封顶不增成本（正常出片远吐不到上限；只有被截断死循环才会持续顶格，抬高反而让它一次成功不再循环）。
	if strings.HasPrefix(model, "claude-opus-4-6") ||
		strings.HasPrefix(model, "claude-opus-4-7") ||
		strings.HasPrefix(model, "claude-opus-4-8") {
		return 128000 // Opus 4.x 输出硬上限 128K，顶满给整章 storyPlan 最大空间
	}
	if strings.HasPrefix(model, "claude-sonnet-4-6") ||
		strings.HasPrefix(model, "claude-sonnet-4-5") {
		return 64000 // Sonnet 4.x 输出硬上限 64K，顶满
	}
	return c.DefaultMaxTokens["default"]
}
