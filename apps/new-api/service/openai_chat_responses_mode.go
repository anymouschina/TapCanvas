package service

import (
	"strings"

	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/service/openaicompat"
	"github.com/QuantumNous/new-api/setting/model_setting"
)

func ShouldChatCompletionsUseResponsesPolicy(policy model_setting.ChatCompletionsToResponsesPolicy, channelID int, channelType int, model string) bool {
	return openaicompat.ShouldChatCompletionsUseResponsesPolicy(policy, channelID, channelType, model)
}

func ShouldChatCompletionsUseResponsesGlobal(channelID int, channelType int, model string) bool {
	return openaicompat.ShouldChatCompletionsUseResponsesGlobal(channelID, channelType, model)
}

// ShouldChatCompletionsUseResponsesForUpstream is a protocol-level built-in
// behavior independent of the global, channel-scoped conversion policy:
// RightCode 的 codex 端点只支持 /v1/responses，gpt-5.x 等上游模型的 chat completions
// 必须经 responses 转换上行。例外：
//   - claude 模型走 /claude/v1/messages 原生通道；
//   - deepseek 模型走 /deepseek/v1/chat/completions（OpenAI 兼容 chat），不能转 responses。
//
// 必须用映射后的上游模型名判断：auto 等虚拟模型经 model_mapping 可能落到 claude。
func ShouldChatCompletionsUseResponsesForUpstream(protocolID string, upstreamModel string) bool {
	if protocolID != constant.ProtocolRightCode {
		return false
	}
	m := strings.ToLower(strings.TrimSpace(upstreamModel))
	if strings.HasPrefix(m, "gpt-4.1") {
		return false
	}
	return m != "" && !strings.HasPrefix(m, "claude") && !strings.HasPrefix(m, "deepseek")
}
