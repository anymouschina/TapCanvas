package oauth

import "strings"

// Claude Code 客户端相关常量
//
// Migrated from sub2api (internal/pkg/claude/constants.go). 这里的常量对齐真实
// Claude Code CLI 的最新流量。Anthropic 上游会基于 anthropic-beta 的完整集合判定
// 请求来源；缺少任何"官方 Claude Code 请求才会带"的 beta，都会被降级到第三方额度。

// Beta header 常量
const (
	BetaOAuth                    = "oauth-2025-04-20"
	BetaClaudeCode               = "claude-code-20250219"
	BetaInterleavedThinking      = "interleaved-thinking-2025-05-14"
	BetaFineGrainedToolStreaming = "fine-grained-tool-streaming-2025-05-14"
	BetaTokenCounting            = "token-counting-2024-11-01"
	BetaContext1M                = "context-1m-2025-08-07"
	BetaFastMode                 = "fast-mode-2026-02-01"

	// 对齐官方 CLI 2.1.9x 以来的流量
	BetaPromptCachingScope = "prompt-caching-scope-2026-01-05"
	BetaEffort             = "effort-2025-11-24"
	BetaRedactThinking     = "redact-thinking-2026-02-12"
	BetaContextManagement  = "context-management-2025-06-27"
	BetaExtendedCacheTTL   = "extended-cache-ttl-2025-04-11"
)

// DefaultBetaHeader Claude Code 客户端默认的 anthropic-beta header
const DefaultBetaHeader = BetaClaudeCode + "," + BetaOAuth + "," + BetaInterleavedThinking + "," + BetaFineGrainedToolStreaming

// MessageBetaHeaderNoTools /v1/messages 在无工具时的 beta header
//
// NOTE: Claude Code OAuth credentials are scoped to Claude Code. When we "mimic"
// Claude Code for non-Claude-Code clients, we must include the claude-code beta
// even if the request doesn't use tools, otherwise upstream may reject the
// request as a non-Claude-Code API request.
const MessageBetaHeaderNoTools = BetaClaudeCode + "," + BetaOAuth + "," + BetaInterleavedThinking

// MessageBetaHeaderWithTools /v1/messages 在有工具时的 beta header
const MessageBetaHeaderWithTools = BetaClaudeCode + "," + BetaOAuth + "," + BetaInterleavedThinking

// CountTokensBetaHeader count_tokens 请求使用的 anthropic-beta header
const CountTokensBetaHeader = BetaClaudeCode + "," + BetaOAuth + "," + BetaInterleavedThinking + "," + BetaTokenCounting

// HaikuBetaHeader Haiku 模型使用的 anthropic-beta header（不需要 claude-code beta）
const HaikuBetaHeader = BetaOAuth + "," + BetaInterleavedThinking

// APIKeyBetaHeader API-key 账号建议使用的 anthropic-beta header（不包含 oauth）
const APIKeyBetaHeader = BetaClaudeCode + "," + BetaInterleavedThinking + "," + BetaFineGrainedToolStreaming

// APIKeyHaikuBetaHeader Haiku 模型在 API-key 账号下使用的 anthropic-beta header（不包含 oauth / claude-code）
const APIKeyHaikuBetaHeader = BetaInterleavedThinking

// DefaultCacheControlTTL 是网关代理为自己生成的 cache_control 块默认使用的 ttl。
const DefaultCacheControlTTL = "5m"

// GetBetaHeader 处理 anthropic-beta header。对于 OAuth 账号，需要确保包含
// oauth-2025-04-20。
//
// Migrated from sub2api gateway_service.go getBetaHeader.
//   - 客户端传了 anthropic-beta：已含 oauth 则原样返回；否则在 claude-code beta
//     之后插入 oauth，没有 claude-code 则放在第一位。
//   - 客户端没传：haiku 模型用 HaikuBetaHeader，其余用 DefaultBetaHeader。
func GetBetaHeader(modelID string, clientBetaHeader string) string {
	// 如果客户端传了 anthropic-beta
	if clientBetaHeader != "" {
		// 已包含 oauth beta 则直接返回
		if strings.Contains(clientBetaHeader, BetaOAuth) {
			return clientBetaHeader
		}

		// 需要添加 oauth beta
		parts := strings.Split(clientBetaHeader, ",")
		for i, p := range parts {
			parts[i] = strings.TrimSpace(p)
		}

		// 在 claude-code-20250219 后面插入 oauth beta
		claudeCodeIdx := -1
		for i, p := range parts {
			if p == BetaClaudeCode {
				claudeCodeIdx = i
				break
			}
		}

		if claudeCodeIdx >= 0 {
			// 在 claude-code 后面插入
			newParts := make([]string, 0, len(parts)+1)
			newParts = append(newParts, parts[:claudeCodeIdx+1]...)
			newParts = append(newParts, BetaOAuth)
			newParts = append(newParts, parts[claudeCodeIdx+1:]...)
			return strings.Join(newParts, ",")
		}

		// 没有 claude-code，放在第一位
		return BetaOAuth + "," + clientBetaHeader
	}

	// 客户端没传，根据模型生成
	// haiku 模型不需要 claude-code beta
	if strings.Contains(strings.ToLower(modelID), "haiku") {
		return HaikuBetaHeader
	}

	return DefaultBetaHeader
}
