package kiro

// ChannelName 渠道标识。
var ChannelName = "kiro"

// ModelList 是 Kiro (AWS CodeWhisperer) free 账号当前可用的模型。
// 模型名直接使用 Kiro 的 modelId，转发时无需额外映射。
var ModelList = []string{
	"auto",
	"claude-sonnet-4.5",
	"claude-sonnet-4",
	"claude-haiku-4.5",
	"deepseek-3.2",
	"minimax-m2.5",
	"minimax-m2.1",
	"glm-5",
	"qwen3-coder-next",
}

const (
	// kiroOrigin 标识请求来源，Kiro 后端要求该字段。
	kiroOrigin = "AI_EDITOR"
	// kiroUserAgent 对齐 Kiro IDE 客户端的 UA，部分接口会校验。
	kiroUserAgent = "aws-sdk-js/1.0.18 ua/2.1 os/windows lang/js md/nodejs#20.16.0 api/codewhispererstreaming#1.0.18 m/E KiroIDE-0.6.18"
	// generateAssistantResponsePath 是对话生成端点。
	generateAssistantResponsePath = "/generateAssistantResponse"
)
