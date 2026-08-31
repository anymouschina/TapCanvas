package kiro

import (
	"encoding/json"
	"errors"
	"strings"
)

// KiroKey 是渠道 Key 的存储格式（JSON 对象）。
// 由 KiroX 注册得到的 free 账号凭据组成：
//
//	{"refreshToken":"...","clientId":"...","clientSecret":"...","region":"us-east-1"}
type KiroKey struct {
	RefreshToken string `json:"refreshToken"`
	ClientID     string `json:"clientId"`
	ClientSecret string `json:"clientSecret"`
	Region       string `json:"region"`
}

// ParseKiroKey 解析渠道 Key。
func ParseKiroKey(raw string) (*KiroKey, error) {
	raw = strings.TrimSpace(raw)
	if !strings.HasPrefix(raw, "{") {
		return nil, errors.New("kiro channel: key 必须是 JSON 对象，包含 refreshToken/clientId/clientSecret")
	}
	var k KiroKey
	if err := json.Unmarshal([]byte(raw), &k); err != nil {
		return nil, errors.New("kiro channel: key JSON 解析失败: " + err.Error())
	}
	if strings.TrimSpace(k.RefreshToken) == "" {
		return nil, errors.New("kiro channel: 缺少 refreshToken")
	}
	if strings.TrimSpace(k.ClientID) == "" || strings.TrimSpace(k.ClientSecret) == "" {
		return nil, errors.New("kiro channel: 缺少 clientId/clientSecret")
	}
	if strings.TrimSpace(k.Region) == "" {
		k.Region = "us-east-1"
	}
	return &k, nil
}

// ---- generateAssistantResponse 请求体 ----

type ConversationStateWrapper struct {
	ConversationState ConversationState `json:"conversationState"`
}

type ConversationState struct {
	ChatTriggerType string        `json:"chatTriggerType"`
	ConversationID  string        `json:"conversationId"`
	CurrentMessage  KiroMessage   `json:"currentMessage"`
	History         []KiroMessage `json:"history,omitempty"`
}

type KiroMessage struct {
	UserInputMessage         *UserInputMessage         `json:"userInputMessage,omitempty"`
	AssistantResponseMessage *AssistantResponseMessage `json:"assistantResponseMessage,omitempty"`
}

type UserInputMessage struct {
	Content                 string                   `json:"content"`
	ModelID                 string                   `json:"modelId,omitempty"`
	Origin                  string                   `json:"origin,omitempty"`
	UserInputMessageContext *UserInputMessageContext `json:"userInputMessageContext,omitempty"`
}

type UserInputMessageContext struct {
	Tools       []KiroTool       `json:"tools,omitempty"`
	ToolResults []KiroToolResult `json:"toolResults,omitempty"`
}

type KiroTool struct {
	ToolSpecification KiroToolSpecification `json:"toolSpecification"`
}

type KiroToolSpecification struct {
	Name        string         `json:"name"`
	Description string         `json:"description,omitempty"`
	InputSchema KiroInputSchema `json:"inputSchema"`
}

type KiroInputSchema struct {
	JSON any `json:"json"`
}

type KiroToolResult struct {
	ToolUseID string                  `json:"toolUseId"`
	Content   []KiroToolResultContent `json:"content"`
	Status    string                  `json:"status"`
}

type KiroToolResultContent struct {
	Text string `json:"text,omitempty"`
}

type AssistantResponseMessage struct {
	Content  string        `json:"content"`
	ToolUses []KiroToolUse `json:"toolUses,omitempty"`
}

type KiroToolUse struct {
	ToolUseID string `json:"toolUseId"`
	Name      string `json:"name"`
	Input     any    `json:"input"`
}

// ---- 事件流 payload ----

// kiroAssistantEvent 对应 assistantResponseEvent。
type kiroAssistantEvent struct {
	Content string `json:"content"`
}

// kiroToolUseEvent 对应 toolUseEvent；input 以字符串分片流式下发。
type kiroToolUseEvent struct {
	ToolUseID string          `json:"toolUseId"`
	Name      string          `json:"name"`
	Input     json.RawMessage `json:"input"`
	Stop      bool            `json:"stop"`
}
