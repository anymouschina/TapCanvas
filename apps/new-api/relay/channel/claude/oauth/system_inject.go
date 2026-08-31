package oauth

import (
	"strings"

	"github.com/tidwall/gjson"
	"github.com/tidwall/sjson"
)

// ClaudeCodeSystemPrompt 是 Claude Code OAuth 请求 system 数组首块必须存在的身份提示词。
// Anthropic 上游基于 system[0] 检测请求来源，缺失/不匹配会被判第三方额度。
const ClaudeCodeSystemPrompt = "You are Claude Code, Anthropic's official CLI for Claude."

// claudeOAuthSystemPromptBlockConfig 描述一个待注入的 system 文本块。
//
// Migrated from sub2api gateway_service.go (claudeOAuthSystemPromptBlockConfig)。
// 去除 billing/fingerprint 模板扩展耦合，仅保留可移植的纯文本块信封。
type claudeOAuthSystemPromptBlockConfig struct {
	Enabled      *bool  `json:"enabled,omitempty"`
	Type         string `json:"type,omitempty"`
	Text         string `json:"text,omitempty"`
	CacheControl any    `json:"cache_control,omitempty"`
}

// claudeOAuthSystemPromptBlocksEnvelope 是 block 配置的对象形态信封。
//
// Migrated from sub2api gateway_service.go (claudeOAuthSystemPromptBlocksEnvelope)。
type claudeOAuthSystemPromptBlocksEnvelope struct {
	Blocks []claudeOAuthSystemPromptBlockConfig `json:"blocks"`
}

// defaultClaudeOAuthSystemPromptBlockConfig 返回内置默认的 Claude Code system 块。
//
// Migrated from sub2api gateway_service.go (defaultClaudeOAuthSystemPromptBlockConfig)。
// 简化为单一身份块（不含 billing 占位符），满足"system[0] 必须是 Claude Code 身份块"
// 的上游要求；更复杂的 billing/expansion 块为 sub2api 风控特化，按 spec 第 4 节 YAGNI 不迁。
func defaultClaudeOAuthSystemPromptBlockConfig() []claudeOAuthSystemPromptBlockConfig {
	enabled := true
	return []claudeOAuthSystemPromptBlockConfig{
		{
			Enabled: &enabled,
			Type:    "text",
			Text:    ClaudeCodeSystemPrompt,
		},
	}
}

// buildClaudeOAuthSystemPromptBlocksJSON 根据 block 配置构造 system 数组的 JSON 值。
//
// Migrated/simplified from sub2api gateway_service.go (buildClaudeOAuthSystemPromptBlocksJSON)。
// 返回一个 []any，可直接用 sjson 写入 "system" 字段。
func buildClaudeOAuthSystemPromptBlocksJSON(blocks []claudeOAuthSystemPromptBlockConfig) []any {
	if len(blocks) == 0 {
		blocks = defaultClaudeOAuthSystemPromptBlockConfig()
	}
	items := make([]any, 0, len(blocks))
	for _, block := range blocks {
		if block.Enabled != nil && !*block.Enabled {
			continue
		}
		blockType := strings.TrimSpace(block.Type)
		if blockType == "" {
			blockType = "text"
		}
		if strings.TrimSpace(block.Text) == "" {
			continue
		}
		entry := map[string]any{
			"type": blockType,
			"text": block.Text,
		}
		if block.CacheControl != nil {
			entry["cache_control"] = block.CacheControl
		}
		items = append(items, entry)
	}
	return items
}

// hasClaudeCodeIdentityPrefix 判断给定文本是否以 Claude Code 身份提示词开头。
func hasClaudeCodeIdentityPrefix(text string) bool {
	return strings.HasPrefix(strings.TrimSpace(text), ClaudeCodeSystemPrompt)
}

// InjectClaudeCodeSystem 确保请求体 body 的 system 数组首块为 Claude Code 身份块。
//
// 行为契约（spec 第 3.A 节）：
//   - 若 system[0] 已是 Claude Code 身份块（数组形态首块文本以身份提示词开头，或
//     字符串形态以身份提示词开头），原样返回 body。
//   - 否则在前面 prepend 默认 Claude Code 身份块，原有 system 内容保留在其后：
//   - 原 system 是字符串：转成 [{身份块}, {type:text, text:原字符串}]。
//   - 原 system 是数组：变为 [{身份块}, ...原数组]。
//   - 原 system 缺失：写入 [{身份块}]。
//
// 仅用 gjson/sjson 操作 []byte，不依赖任何 internal 状态。
func InjectClaudeCodeSystem(body []byte) ([]byte, error) {
	system := gjson.GetBytes(body, "system")

	identityBlocks := buildClaudeOAuthSystemPromptBlocksJSON(nil)

	switch {
	case !system.Exists():
		return sjson.SetBytes(body, "system", identityBlocks)

	case system.Type == gjson.String:
		original := system.String()
		if hasClaudeCodeIdentityPrefix(original) {
			return body, nil
		}
		// 转成数组形态：身份块在前，原字符串作为 text 块在后
		newBlocks := append([]any{}, identityBlocks...)
		if strings.TrimSpace(original) != "" {
			newBlocks = append(newBlocks, map[string]any{
				"type": "text",
				"text": original,
			})
		}
		return sjson.SetBytes(body, "system", newBlocks)

	case system.IsArray():
		arr := system.Array()
		if len(arr) > 0 && hasClaudeCodeIdentityPrefix(arr[0].Get("text").String()) {
			// 首块已是身份块，原样返回
			return body, nil
		}
		// prepend 身份块：先写入身份块数组，再把原有元素逐个 append 回去（保留原始 JSON）。
		out, err := sjson.SetBytes(body, "system", identityBlocks)
		if err != nil {
			return nil, err
		}
		for _, item := range arr {
			out, err = sjson.SetRawBytes(out, "system.-1", []byte(item.Raw))
			if err != nil {
				return nil, err
			}
		}
		return out, nil

	default:
		// 其他类型（object / 非法）：直接覆盖为身份块
		return sjson.SetBytes(body, "system", identityBlocks)
	}
}
