package claude

import (
	"encoding/base64"
	"strings"
	"testing"

	"github.com/QuantumNous/new-api/dto"
	"github.com/stretchr/testify/require"
)

func TestFormatClaudeResponseInfo_MessageStart(t *testing.T) {
	claudeInfo := &ClaudeResponseInfo{
		Usage: &dto.Usage{},
	}
	claudeResponse := &dto.ClaudeResponse{
		Type: "message_start",
		Message: &dto.ClaudeMediaMessage{
			Id:    "msg_123",
			Model: "claude-3-5-sonnet",
			Usage: &dto.ClaudeUsage{
				InputTokens:              100,
				OutputTokens:             1,
				CacheCreationInputTokens: 50,
				CacheReadInputTokens:     30,
			},
		},
	}

	ok := FormatClaudeResponseInfo(claudeResponse, nil, claudeInfo)
	if !ok {
		t.Fatal("expected true")
	}
	if claudeInfo.Usage.PromptTokens != 100 {
		t.Errorf("PromptTokens = %d, want 100", claudeInfo.Usage.PromptTokens)
	}
	if claudeInfo.Usage.PromptTokensDetails.CachedTokens != 30 {
		t.Errorf("CachedTokens = %d, want 30", claudeInfo.Usage.PromptTokensDetails.CachedTokens)
	}
	if claudeInfo.Usage.PromptTokensDetails.CachedCreationTokens != 50 {
		t.Errorf("CachedCreationTokens = %d, want 50", claudeInfo.Usage.PromptTokensDetails.CachedCreationTokens)
	}
	if claudeInfo.ResponseId != "msg_123" {
		t.Errorf("ResponseId = %s, want msg_123", claudeInfo.ResponseId)
	}
	if claudeInfo.Model != "claude-3-5-sonnet" {
		t.Errorf("Model = %s, want claude-3-5-sonnet", claudeInfo.Model)
	}
}

func TestFormatClaudeResponseInfo_MessageDelta_FullUsage(t *testing.T) {
	// message_start 先积累 usage
	claudeInfo := &ClaudeResponseInfo{
		Usage: &dto.Usage{
			PromptTokens: 100,
			PromptTokensDetails: dto.InputTokenDetails{
				CachedTokens:         30,
				CachedCreationTokens: 50,
			},
			CompletionTokens: 1,
		},
	}

	// message_delta 带完整 usage（原生 Anthropic 场景）
	claudeResponse := &dto.ClaudeResponse{
		Type: "message_delta",
		Usage: &dto.ClaudeUsage{
			InputTokens:              100,
			OutputTokens:             200,
			CacheCreationInputTokens: 50,
			CacheReadInputTokens:     30,
		},
	}

	ok := FormatClaudeResponseInfo(claudeResponse, nil, claudeInfo)
	if !ok {
		t.Fatal("expected true")
	}
	if claudeInfo.Usage.PromptTokens != 100 {
		t.Errorf("PromptTokens = %d, want 100", claudeInfo.Usage.PromptTokens)
	}
	if claudeInfo.Usage.CompletionTokens != 200 {
		t.Errorf("CompletionTokens = %d, want 200", claudeInfo.Usage.CompletionTokens)
	}
	if claudeInfo.Usage.TotalTokens != 300 {
		t.Errorf("TotalTokens = %d, want 300", claudeInfo.Usage.TotalTokens)
	}
	if !claudeInfo.Done {
		t.Error("expected Done = true")
	}
}

func TestFormatClaudeResponseInfo_MessageDelta_OnlyOutputTokens(t *testing.T) {
	// 模拟 Bedrock: message_start 已积累 usage
	claudeInfo := &ClaudeResponseInfo{
		Usage: &dto.Usage{
			PromptTokens: 100,
			PromptTokensDetails: dto.InputTokenDetails{
				CachedTokens:         30,
				CachedCreationTokens: 50,
			},
			CompletionTokens:            1,
			ClaudeCacheCreation5mTokens: 10,
			ClaudeCacheCreation1hTokens: 20,
		},
	}

	// Bedrock 的 message_delta 只有 output_tokens，缺少 input_tokens 和 cache 字段
	claudeResponse := &dto.ClaudeResponse{
		Type: "message_delta",
		Usage: &dto.ClaudeUsage{
			OutputTokens: 200,
			// InputTokens, CacheCreationInputTokens, CacheReadInputTokens 都是 0
		},
	}

	ok := FormatClaudeResponseInfo(claudeResponse, nil, claudeInfo)
	if !ok {
		t.Fatal("expected true")
	}
	// PromptTokens 应保持 message_start 的值（因为 message_delta 的 InputTokens=0，不更新）
	if claudeInfo.Usage.PromptTokens != 100 {
		t.Errorf("PromptTokens = %d, want 100", claudeInfo.Usage.PromptTokens)
	}
	if claudeInfo.Usage.CompletionTokens != 200 {
		t.Errorf("CompletionTokens = %d, want 200", claudeInfo.Usage.CompletionTokens)
	}
	if claudeInfo.Usage.TotalTokens != 300 {
		t.Errorf("TotalTokens = %d, want 300", claudeInfo.Usage.TotalTokens)
	}
	// cache 字段应保持 message_start 的值
	if claudeInfo.Usage.PromptTokensDetails.CachedTokens != 30 {
		t.Errorf("CachedTokens = %d, want 30", claudeInfo.Usage.PromptTokensDetails.CachedTokens)
	}
	if claudeInfo.Usage.PromptTokensDetails.CachedCreationTokens != 50 {
		t.Errorf("CachedCreationTokens = %d, want 50", claudeInfo.Usage.PromptTokensDetails.CachedCreationTokens)
	}
	if claudeInfo.Usage.ClaudeCacheCreation5mTokens != 10 {
		t.Errorf("ClaudeCacheCreation5mTokens = %d, want 10", claudeInfo.Usage.ClaudeCacheCreation5mTokens)
	}
	if claudeInfo.Usage.ClaudeCacheCreation1hTokens != 20 {
		t.Errorf("ClaudeCacheCreation1hTokens = %d, want 20", claudeInfo.Usage.ClaudeCacheCreation1hTokens)
	}
	if !claudeInfo.Done {
		t.Error("expected Done = true")
	}
}

func TestFormatClaudeResponseInfo_NilClaudeInfo(t *testing.T) {
	claudeResponse := &dto.ClaudeResponse{Type: "message_start"}
	ok := FormatClaudeResponseInfo(claudeResponse, nil, nil)
	if ok {
		t.Error("expected false for nil claudeInfo")
	}
}

func TestFormatClaudeResponseInfo_ContentBlockDelta(t *testing.T) {
	text := "hello"
	claudeInfo := &ClaudeResponseInfo{
		Usage:        &dto.Usage{},
		ResponseText: strings.Builder{},
	}
	claudeResponse := &dto.ClaudeResponse{
		Type: "content_block_delta",
		Delta: &dto.ClaudeMediaMessage{
			Text: &text,
		},
	}

	ok := FormatClaudeResponseInfo(claudeResponse, nil, claudeInfo)
	if !ok {
		t.Fatal("expected true")
	}
	if claudeInfo.ResponseText.String() != "hello" {
		t.Errorf("ResponseText = %q, want %q", claudeInfo.ResponseText.String(), "hello")
	}
}

func TestBuildOpenAIStyleUsageFromClaudeUsage(t *testing.T) {
	usage := &dto.Usage{
		PromptTokens:     100,
		CompletionTokens: 20,
		PromptTokensDetails: dto.InputTokenDetails{
			CachedTokens:         30,
			CachedCreationTokens: 50,
		},
		ClaudeCacheCreation5mTokens: 10,
		ClaudeCacheCreation1hTokens: 20,
		UsageSemantic:               "anthropic",
	}

	openAIUsage := buildOpenAIStyleUsageFromClaudeUsage(usage)

	if openAIUsage.PromptTokens != 180 {
		t.Fatalf("PromptTokens = %d, want 180", openAIUsage.PromptTokens)
	}
	if openAIUsage.InputTokens != 180 {
		t.Fatalf("InputTokens = %d, want 180", openAIUsage.InputTokens)
	}
	if openAIUsage.TotalTokens != 200 {
		t.Fatalf("TotalTokens = %d, want 200", openAIUsage.TotalTokens)
	}
	if openAIUsage.UsageSemantic != "openai" {
		t.Fatalf("UsageSemantic = %s, want openai", openAIUsage.UsageSemantic)
	}
	if openAIUsage.UsageSource != "anthropic" {
		t.Fatalf("UsageSource = %s, want anthropic", openAIUsage.UsageSource)
	}
}

func TestBuildOpenAIStyleUsageFromClaudeUsagePreservesCacheCreationRemainder(t *testing.T) {
	tests := []struct {
		name                    string
		cachedCreationTokens    int
		cacheCreationTokens5m   int
		cacheCreationTokens1h   int
		expectedTotalInputToken int
	}{
		{
			name:                    "prefers aggregate when it includes remainder",
			cachedCreationTokens:    50,
			cacheCreationTokens5m:   10,
			cacheCreationTokens1h:   20,
			expectedTotalInputToken: 180,
		},
		{
			name:                    "falls back to split tokens when aggregate missing",
			cachedCreationTokens:    0,
			cacheCreationTokens5m:   10,
			cacheCreationTokens1h:   20,
			expectedTotalInputToken: 160,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			usage := &dto.Usage{
				PromptTokens:     100,
				CompletionTokens: 20,
				PromptTokensDetails: dto.InputTokenDetails{
					CachedTokens:         30,
					CachedCreationTokens: tt.cachedCreationTokens,
				},
				ClaudeCacheCreation5mTokens: tt.cacheCreationTokens5m,
				ClaudeCacheCreation1hTokens: tt.cacheCreationTokens1h,
				UsageSemantic:               "anthropic",
			}

			openAIUsage := buildOpenAIStyleUsageFromClaudeUsage(usage)

			if openAIUsage.PromptTokens != tt.expectedTotalInputToken {
				t.Fatalf("PromptTokens = %d, want %d", openAIUsage.PromptTokens, tt.expectedTotalInputToken)
			}
			if openAIUsage.InputTokens != tt.expectedTotalInputToken {
				t.Fatalf("InputTokens = %d, want %d", openAIUsage.InputTokens, tt.expectedTotalInputToken)
			}
		})
	}
}

func TestBuildOpenAIStyleUsageFromClaudeUsageDefaultsAggregateCacheCreationTo5m(t *testing.T) {
	usage := &dto.Usage{
		PromptTokens:     100,
		CompletionTokens: 20,
		PromptTokensDetails: dto.InputTokenDetails{
			CachedTokens:         30,
			CachedCreationTokens: 50,
		},
		UsageSemantic: "anthropic",
	}

	openAIUsage := buildOpenAIStyleUsageFromClaudeUsage(usage)

	require.Equal(t, 50, openAIUsage.ClaudeCacheCreation5mTokens)
	require.Equal(t, 0, openAIUsage.ClaudeCacheCreation1hTokens)
}

func TestRequestOpenAI2ClaudeMessage_RejectsUnsupportedFileContent(t *testing.T) {
	request := dto.GeneralOpenAIRequest{
		Model: "claude-3-5-sonnet",
		Messages: []dto.Message{
			{
				Role: "user",
				Content: []any{
					dto.MediaContent{
						Type: dto.ContentTypeText,
						Text: "see attachment",
					},
					dto.MediaContent{
						Type: dto.ContentTypeFile,
						File: &dto.MessageFile{
							FileName: "blob.bin",
							FileData: "JVBERi0xLjQK",
						},
					},
				},
			},
		},
	}

	claudeRequest, err := RequestOpenAI2ClaudeMessage(nil, request, false)
	require.Error(t, err)
	require.Nil(t, claudeRequest)
	require.Contains(t, err.Error(), "blob.bin")
	require.Contains(t, err.Error(), "不支持")
}

func TestRequestOpenAI2ClaudeMessage_SupportsPDFFileContent(t *testing.T) {
	request := dto.GeneralOpenAIRequest{
		Model: "claude-3-5-sonnet",
		Messages: []dto.Message{
			{
				Role: "user",
				Content: []any{
					dto.MediaContent{
						Type: dto.ContentTypeFile,
						File: &dto.MessageFile{
							FileName: "spec.pdf",
							FileData: "JVBERi0xLjQK",
						},
					},
					dto.MediaContent{
						Type: dto.ContentTypeText,
						Text: "summarize it",
					},
				},
			},
		},
	}

	claudeRequest, err := RequestOpenAI2ClaudeMessage(nil, request, false)
	require.NoError(t, err)
	require.Len(t, claudeRequest.Messages, 1)

	content, ok := claudeRequest.Messages[0].Content.([]dto.ClaudeMediaMessage)
	require.True(t, ok)
	require.Len(t, content, 2)
	require.Equal(t, "document", content[0].Type)
	require.NotNil(t, content[0].Source)
	require.Equal(t, "base64", content[0].Source.Type)
	require.Equal(t, "application/pdf", content[0].Source.MediaType)
	require.Equal(t, "JVBERi0xLjQK", content[0].Source.Data)
	require.Equal(t, "text", content[1].Type)
	require.NotNil(t, content[1].Text)
	require.Equal(t, "summarize it", *content[1].Text)
}

func TestRequestOpenAI2ClaudeMessage_ConvertsTextFileContentToText(t *testing.T) {
	request := dto.GeneralOpenAIRequest{
		Model: "claude-3-5-sonnet",
		Messages: []dto.Message{
			{
				Role: "user",
				Content: []any{
					dto.MediaContent{
						Type: dto.ContentTypeFile,
						File: &dto.MessageFile{
							FileName: "notes.txt",
							FileData: base64.StdEncoding.EncodeToString([]byte("alpha\nbeta")),
						},
					},
				},
			},
		},
	}

	claudeRequest, err := RequestOpenAI2ClaudeMessage(nil, request, false)
	require.NoError(t, err)
	require.Len(t, claudeRequest.Messages, 1)

	content, ok := claudeRequest.Messages[0].Content.([]dto.ClaudeMediaMessage)
	require.True(t, ok)
	require.Len(t, content, 1)
	require.Equal(t, "text", content[0].Type)
	require.NotNil(t, content[0].Text)
	require.Equal(t, "alpha\nbeta", *content[0].Text)
}

// passThroughImageURL=true 时，http(s) 图片应以 type:url 直通上游，绝不下载转 base64
// （省去每轮把整张图 base64 内联重传的带宽/上下文开销）。
func TestRequestOpenAI2ClaudeMessage_ImageURLPassThrough(t *testing.T) {
	const imageURL = "https://file.beqlee.icu/gen/images/sample.png"
	request := dto.GeneralOpenAIRequest{
		Model: "claude-opus-4-8",
		Messages: []dto.Message{
			{
				Role: "user",
				Content: []any{
					dto.MediaContent{
						Type:     dto.ContentTypeImageURL,
						ImageUrl: &dto.MessageImageUrl{Url: imageURL},
					},
				},
			},
		},
	}

	claudeRequest, err := RequestOpenAI2ClaudeMessage(nil, request, true)
	require.NoError(t, err)
	require.Len(t, claudeRequest.Messages, 1)

	content, ok := claudeRequest.Messages[0].Content.([]dto.ClaudeMediaMessage)
	require.True(t, ok)
	require.Len(t, content, 1)
	require.Equal(t, "image", content[0].Type)
	require.NotNil(t, content[0].Source)
	require.Equal(t, "url", content[0].Source.Type)
	require.Equal(t, imageURL, content[0].Source.Url)
	require.Empty(t, content[0].Source.Data)
}

// 空/非法 arguments 的 tool_use 绝不能被丢弃：丢了而 tool_result 还在会触发
// Anthropic "unexpected tool_use_id found in tool_result blocks" 400，
// 且坏参数持久化在会话历史中会让该会话永久打不通（实测毒死章节会话）。
func TestRequestOpenAI2ClaudeMessage_KeepsToolUseWithEmptyOrInvalidArguments(t *testing.T) {
	assistant := dto.Message{Role: "assistant", Content: ""}
	assistant.SetToolCalls([]dto.ToolCallRequest{
		{ID: "toolu_empty", Type: "function", Function: dto.FunctionRequest{Name: "flow_get", Arguments: ""}},
		{ID: "toolu_bad", Type: "function", Function: dto.FunctionRequest{Name: "broken", Arguments: "{truncated"}},
		{ID: "toolu_ok", Type: "function", Function: dto.FunctionRequest{Name: "good", Arguments: `{"a":1}`}},
	})
	request := dto.GeneralOpenAIRequest{
		Model: "claude-3-5-sonnet",
		Messages: []dto.Message{
			{Role: "user", Content: "hi"},
			assistant,
			{Role: "tool", Content: "result-empty", ToolCallId: "toolu_empty"},
			{Role: "tool", Content: "result-bad", ToolCallId: "toolu_bad"},
			{Role: "tool", Content: "result-ok", ToolCallId: "toolu_ok"},
		},
	}

	claudeRequest, err := RequestOpenAI2ClaudeMessage(nil, request, false)
	require.NoError(t, err)

	var assistantContent []dto.ClaudeMediaMessage
	for _, msg := range claudeRequest.Messages {
		if msg.Role != "assistant" {
			continue
		}
		content, ok := msg.Content.([]dto.ClaudeMediaMessage)
		require.True(t, ok)
		assistantContent = content
	}

	ids := make(map[string]dto.ClaudeMediaMessage)
	for _, block := range assistantContent {
		if block.Type == "tool_use" {
			ids[block.Id] = block
		}
	}
	require.Len(t, ids, 3, "all tool_use blocks must survive regardless of arguments validity")
	require.Equal(t, map[string]any{}, ids["toolu_empty"].Input, "empty arguments become {}")
	require.Equal(t, map[string]any{"_raw": "{truncated"}, ids["toolu_bad"].Input, "invalid JSON kept as _raw")
	require.Equal(t, map[string]any{"a": float64(1)}, ids["toolu_ok"].Input)
}

func TestRequestOpenAI2ClaudeMessage_ToolSchemaAlignsWithAnthropicSpec(t *testing.T) {
	request := dto.GeneralOpenAIRequest{
		Model: "claude-fable-5",
		Messages: []dto.Message{
			{Role: "user", Content: "hi"},
		},
		Tools: []dto.ToolCallRequest{
			{
				Type:     "function",
				Function: dto.FunctionRequest{Name: "ping", Description: "no params at all"},
			},
			{
				Type:     "function",
				Function: dto.FunctionRequest{Name: "empty", Parameters: map[string]any{}},
			},
			{
				Type: "function",
				Function: dto.FunctionRequest{
					Name: "get_weather",
					Parameters: map[string]any{
						"type":       "object",
						"properties": map[string]any{"city": map[string]any{"type": "string"}},
						"required":   []any{"city"},
					},
				},
			},
		},
	}

	claudeRequest, err := RequestOpenAI2ClaudeMessage(nil, request, false)
	require.NoError(t, err)
	tools, ok := claudeRequest.Tools.([]any)
	require.True(t, ok)
	// Zero-arg tools must not be dropped.
	require.Len(t, tools, 3)

	for i, name := range []string{"ping", "empty", "get_weather"} {
		tool, ok := tools[i].(*dto.Tool)
		require.True(t, ok)
		require.Equal(t, name, tool.Name)
		// Anthropic requires input_schema.type to be present.
		require.Equal(t, "object", tool.InputSchema["type"])
	}

	// No `properties: null` / `required: null` emitted for schema-less tools.
	pingTool := tools[0].(*dto.Tool)
	_, hasProps := pingTool.InputSchema["properties"]
	require.False(t, hasProps)
	_, hasRequired := pingTool.InputSchema["required"]
	require.False(t, hasRequired)

	weatherTool := tools[2].(*dto.Tool)
	require.NotNil(t, weatherTool.InputSchema["properties"])
	require.NotNil(t, weatherTool.InputSchema["required"])
}

// 验证：除 system 外，会话历史的最后一条消息也被打上 cache_control 断点，
// 让累积的工具历史按缓存价命中，而不是每轮全价 prefill。
func TestRequestOpenAI2ClaudeMessage_CachesSystemAndLastMessage(t *testing.T) {
	assistant := dto.Message{Role: "assistant", Content: ""}
	assistant.SetToolCalls([]dto.ToolCallRequest{
		{ID: "toolu_1", Type: "function", Function: dto.FunctionRequest{Name: "flow_get", Arguments: `{"a":1}`}},
	})
	request := dto.GeneralOpenAIRequest{
		Model: "claude-opus-4-8",
		Messages: []dto.Message{
			{Role: "system", Content: "long stable persona + skills catalog"},
			{Role: "user", Content: "把第38章做成视频"},
			assistant,
			{Role: "tool", Content: "result-ok", ToolCallId: "toolu_1"},
		},
	}

	claudeRequest, err := RequestOpenAI2ClaudeMessage(nil, request, false)
	require.NoError(t, err)

	// system 末块仍有断点（原有行为不回归）。
	sys, ok := claudeRequest.System.([]dto.ClaudeMediaMessage)
	require.True(t, ok, "system 应为 block 数组")
	require.NotEmpty(t, sys)
	require.NotEmpty(t, sys[len(sys)-1].CacheControl,
		"system 最后一个 block 必须保留 cache_control")

	// 最后一条消息（tool_result）的最后一个 block 拿到断点。
	require.NotEmpty(t, claudeRequest.Messages)
	last := claudeRequest.Messages[len(claudeRequest.Messages)-1]
	blocks, ok := last.Content.([]dto.ClaudeMediaMessage)
	require.True(t, ok, "tool_result 消息内容应为 block 数组")
	require.NotEmpty(t, blocks)
	require.NotEmpty(t, blocks[len(blocks)-1].CacheControl,
		"会话最后一个 block 必须被打上 cache_control 断点")

	// 中间消息不应被误打断点（只缓存到末尾即可，Anthropic 自动读最长前缀）。
	mid := claudeRequest.Messages[0]
	if midBlocks, ok := mid.Content.([]dto.ClaudeMediaMessage); ok {
		for _, b := range midBlocks {
			require.Empty(t, b.CacheControl, "中间消息不应被打断点")
		}
	}
}

// 纯字符串内容的末条消息（无工具调用的普通用户轮）也要能挂上断点：
// 字符串内容会被转成单个 text block 承载 cache_control。
func TestRequestOpenAI2ClaudeMessage_CachesStringLastMessage(t *testing.T) {
	request := dto.GeneralOpenAIRequest{
		Model: "claude-opus-4-8",
		Messages: []dto.Message{
			{Role: "system", Content: "persona"},
			{Role: "user", Content: "你好"},
		},
	}

	claudeRequest, err := RequestOpenAI2ClaudeMessage(nil, request, false)
	require.NoError(t, err)

	require.NotEmpty(t, claudeRequest.Messages)
	last := claudeRequest.Messages[len(claudeRequest.Messages)-1]
	blocks, ok := last.Content.([]dto.ClaudeMediaMessage)
	require.True(t, ok, "字符串内容应转成 block 数组以承载 cache_control")
	require.Len(t, blocks, 1)
	require.Equal(t, "text", blocks[0].Type)
	require.Equal(t, "你好", blocks[0].GetText())
	require.NotEmpty(t, blocks[0].CacheControl)
}

// 验证 system 动态边界拆分：含 __SYSTEM_PROMPT_DYNAMIC_BOUNDARY__ 的 system 被切成
// [stable][dynamic] 两块，cache_control 只打稳定块、标记被剥离、动态块不带断点。
func TestRequestOpenAI2ClaudeMessage_SplitsSystemAtDynamicBoundary(t *testing.T) {
	sysText := "稳定人设 + 技能目录(逐字节稳定)\n__SYSTEM_PROMPT_DYNAMIC_BOUNDARY__\n\nquery-RAG 知识(每轮变)"
	request := dto.GeneralOpenAIRequest{
		Model: "claude-opus-4-8",
		Messages: []dto.Message{
			{Role: "system", Content: sysText},
			{Role: "user", Content: "做点什么"},
		},
	}

	claudeRequest, err := RequestOpenAI2ClaudeMessage(nil, request, false)
	require.NoError(t, err)

	sys, ok := claudeRequest.System.([]dto.ClaudeMediaMessage)
	require.True(t, ok)
	require.Len(t, sys, 2, "应拆成 稳定块 + 动态块 两块")

	// 标记被剥离，谁都不应再含它。
	for _, b := range sys {
		require.NotNil(t, b.Text)
		require.NotContains(t, *b.Text, "__SYSTEM_PROMPT_DYNAMIC_BOUNDARY__", "边界标记必须被剥离")
	}
	// 稳定块（第0块）带断点；动态块（第1块）不带。
	require.Contains(t, *sys[0].Text, "稳定人设")
	require.NotEmpty(t, sys[0].CacheControl, "稳定块必须打 cache_control")
	require.Contains(t, *sys[1].Text, "query-RAG")
	require.Empty(t, sys[1].CacheControl, "动态块不应进缓存")
}

// 无边界标记时退回旧行为：整段 system 作为单块拿到断点。
func TestRequestOpenAI2ClaudeMessage_SystemWithoutBoundaryFallsBack(t *testing.T) {
	request := dto.GeneralOpenAIRequest{
		Model:    "claude-opus-4-8",
		Messages: []dto.Message{{Role: "system", Content: "无标记的稳定 system"}, {Role: "user", Content: "hi"}},
	}
	claudeRequest, err := RequestOpenAI2ClaudeMessage(nil, request, false)
	require.NoError(t, err)
	sys, ok := claudeRequest.System.([]dto.ClaudeMediaMessage)
	require.True(t, ok)
	require.Len(t, sys, 1)
	require.NotEmpty(t, sys[0].CacheControl)
}

// 验证 tools 缓存断点：最后一个函数工具拿到 cache_control。
func TestRequestOpenAI2ClaudeMessage_CachesLastTool(t *testing.T) {
	request := dto.GeneralOpenAIRequest{
		Model:    "claude-opus-4-8",
		Messages: []dto.Message{{Role: "user", Content: "hi"}},
		Tools: []dto.ToolCallRequest{
			{Type: "function", Function: dto.FunctionRequest{Name: "first", Description: "a"}},
			{Type: "function", Function: dto.FunctionRequest{Name: "last", Description: "b"}},
		},
	}
	claudeRequest, err := RequestOpenAI2ClaudeMessage(nil, request, false)
	require.NoError(t, err)
	tools, ok := claudeRequest.Tools.([]any)
	require.True(t, ok)
	require.GreaterOrEqual(t, len(tools), 2)
	first := tools[0].(*dto.Tool)
	last := tools[len(tools)-1].(*dto.Tool)
	require.Empty(t, first.CacheControl, "非末工具不应带断点")
	require.NotEmpty(t, last.CacheControl, "末工具必须带 cache_control 断点")
}
