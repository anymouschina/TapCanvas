package kiro

import (
	"encoding/binary"
	"encoding/json"
	"io"
	"net/http"
	"strings"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/dto"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	"github.com/QuantumNous/new-api/relay/helper"
	"github.com/QuantumNous/new-api/service"
	"github.com/QuantumNous/new-api/types"

	"github.com/gin-gonic/gin"
)

// ============ 请求转换：OpenAI -> Kiro conversationState ============

func convertOpenAIRequest(info *relaycommon.RelayInfo, request *dto.GeneralOpenAIRequest) *ConversationStateWrapper {
	modelID := info.UpstreamModelName

	var systemParts []string
	var msgs []KiroMessage
	// pendingToolResult 指向用于承载连续 tool 结果的 userInputMessage。
	var pendingToolResult *UserInputMessage

	for _, m := range request.Messages {
		switch m.Role {
		case "system", "developer":
			if s := strings.TrimSpace(m.StringContent()); s != "" {
				systemParts = append(systemParts, s)
			}
		case "assistant":
			pendingToolResult = nil
			arm := &AssistantResponseMessage{Content: m.StringContent()}
			for _, tc := range m.ParseToolCalls() {
				var input any
				if strings.TrimSpace(tc.Function.Arguments) != "" {
					_ = json.Unmarshal([]byte(tc.Function.Arguments), &input)
				}
				if input == nil {
					input = map[string]any{}
				}
				arm.ToolUses = append(arm.ToolUses, KiroToolUse{
					ToolUseID: tc.ID,
					Name:      tc.Function.Name,
					Input:     input,
				})
			}
			msgs = append(msgs, KiroMessage{AssistantResponseMessage: arm})
		case "tool":
			tr := KiroToolResult{
				ToolUseID: m.ToolCallId,
				Status:    "success",
				Content:   []KiroToolResultContent{{Text: m.StringContent()}},
			}
			if pendingToolResult == nil {
				pendingToolResult = &UserInputMessage{
					Content:                 "",
					ModelID:                 modelID,
					Origin:                  kiroOrigin,
					UserInputMessageContext: &UserInputMessageContext{},
				}
				msgs = append(msgs, KiroMessage{UserInputMessage: pendingToolResult})
			}
			pendingToolResult.UserInputMessageContext.ToolResults = append(
				pendingToolResult.UserInputMessageContext.ToolResults, tr)
		default: // user 及其它
			pendingToolResult = nil
			msgs = append(msgs, KiroMessage{UserInputMessage: &UserInputMessage{
				Content: m.StringContent(),
				ModelID: modelID,
				Origin:  kiroOrigin,
			}})
		}
	}

	// system prompt 合并到第一条 userInputMessage 的开头。
	if len(systemParts) > 0 {
		sys := strings.Join(systemParts, "\n")
		attached := false
		for i := range msgs {
			if msgs[i].UserInputMessage != nil {
				if c := strings.TrimSpace(msgs[i].UserInputMessage.Content); c != "" {
					msgs[i].UserInputMessage.Content = sys + "\n\n" + msgs[i].UserInputMessage.Content
				} else {
					msgs[i].UserInputMessage.Content = sys
				}
				attached = true
				break
			}
		}
		if !attached {
			msgs = append(msgs, KiroMessage{UserInputMessage: &UserInputMessage{
				Content: sys, ModelID: modelID, Origin: kiroOrigin,
			}})
		}
	}

	// 取最后一条 userInputMessage 作为 currentMessage，其余作为 history。
	currentIdx := -1
	for i := len(msgs) - 1; i >= 0; i-- {
		if msgs[i].UserInputMessage != nil {
			currentIdx = i
			break
		}
	}
	var current UserInputMessage
	var history []KiroMessage
	if currentIdx >= 0 {
		current = *msgs[currentIdx].UserInputMessage
		history = append(history, msgs[:currentIdx]...)
		history = append(history, msgs[currentIdx+1:]...)
	} else {
		// 极端情况：没有任何 user 消息，构造占位 current。
		current = UserInputMessage{Content: "Continue.", ModelID: modelID, Origin: kiroOrigin}
		history = msgs
	}
	if current.ModelID == "" {
		current.ModelID = modelID
	}
	if current.Origin == "" {
		current.Origin = kiroOrigin
	}

	// 工具声明挂到 currentMessage 的 context。
	if len(request.Tools) > 0 {
		if current.UserInputMessageContext == nil {
			current.UserInputMessageContext = &UserInputMessageContext{}
		}
		for _, t := range request.Tools {
			current.UserInputMessageContext.Tools = append(current.UserInputMessageContext.Tools, KiroTool{
				ToolSpecification: KiroToolSpecification{
					Name:        t.Function.Name,
					Description: t.Function.Description,
					InputSchema: KiroInputSchema{JSON: t.Function.Parameters},
				},
			})
		}
	}

	return &ConversationStateWrapper{
		ConversationState: ConversationState{
			ChatTriggerType: "MANUAL",
			ConversationID:  common.GetUUID(),
			CurrentMessage:  KiroMessage{UserInputMessage: &current},
			History:         history,
		},
	}
}

// ============ 事件流解析 ============

type kiroEvent struct {
	eventType string
	payload   []byte
}

// parseFrames 从 buf 中切出完整的 AWS event-stream 帧，返回解析出的事件与剩余字节。
// 帧结构: [总长度:4][headers长度:4][prelude crc:4][headers][payload][msg crc:4]
func parseFrames(buf []byte) ([]kiroEvent, []byte) {
	var events []kiroEvent
	for len(buf) >= 12 {
		total := binary.BigEndian.Uint32(buf[0:4])
		if total < 16 || int(total) > len(buf) {
			break
		}
		headerLen := binary.BigEndian.Uint32(buf[4:8])
		payloadStart := 12 + int(headerLen)
		payloadEnd := int(total) - 4
		if payloadStart > payloadEnd || payloadEnd > len(buf) {
			// 帧异常，跳过避免死循环。
			buf = buf[total:]
			continue
		}
		headers := buf[12:payloadStart]
		payload := buf[payloadStart:payloadEnd]
		events = append(events, kiroEvent{
			eventType: extractEventType(headers),
			payload:   append([]byte(nil), payload...),
		})
		buf = buf[total:]
	}
	return events, buf
}

// extractEventType 从二进制 headers 中取出 :event-type 的值。
func extractEventType(h []byte) string {
	i := 0
	for i < len(h) {
		nameLen := int(h[i])
		i++
		if i+nameLen > len(h) {
			break
		}
		name := string(h[i : i+nameLen])
		i += nameLen
		if i >= len(h) {
			break
		}
		typ := h[i]
		i++
		switch typ {
		case 7, 6: // string / byte array: [len:2][value]
			if i+2 > len(h) {
				return ""
			}
			vlen := int(binary.BigEndian.Uint16(h[i : i+2]))
			i += 2
			if i+vlen > len(h) {
				return ""
			}
			val := string(h[i : i+vlen])
			i += vlen
			if name == ":event-type" {
				return val
			}
		case 0, 1: // bool, 无值
		case 2: // byte
			i++
		case 3: // short
			i += 2
		case 4: // int
			i += 4
		case 5, 8: // long / timestamp
			i += 8
		case 9: // uuid
			i += 16
		default:
			return ""
		}
	}
	return ""
}

// toolAccumulator 累积单个 tool 调用的分片输入。
type toolAccumulator struct {
	id    string
	name  string
	input strings.Builder
	index int
}

// kiroEventCollector 汇总事件流中的文本与工具调用。
type kiroEventCollector struct {
	text      strings.Builder
	tools     map[string]*toolAccumulator
	toolOrder []string
}

func newCollector() *kiroEventCollector {
	return &kiroEventCollector{tools: map[string]*toolAccumulator{}}
}

// handle 处理一个事件；若产生了应立即下发的增量（文本/完成的工具），通过回调返回。
func (col *kiroEventCollector) handle(ev kiroEvent, onText func(string), onToolDone func(*toolAccumulator)) {
	switch {
	case isToolEvent(ev):
		var te kiroToolUseEvent
		if json.Unmarshal(ev.payload, &te) != nil {
			return
		}
		acc := col.tools[te.ToolUseID]
		if acc == nil {
			acc = &toolAccumulator{id: te.ToolUseID, index: len(col.toolOrder)}
			col.tools[te.ToolUseID] = acc
			col.toolOrder = append(col.toolOrder, te.ToolUseID)
		}
		if te.Name != "" {
			acc.name = te.Name
		}
		if len(te.Input) > 0 {
			var s string
			if json.Unmarshal(te.Input, &s) == nil {
				acc.input.WriteString(s)
			} else {
				acc.input.Write(te.Input)
			}
		}
		if te.Stop && onToolDone != nil {
			onToolDone(acc)
		}
	default:
		var ae kiroAssistantEvent
		if json.Unmarshal(ev.payload, &ae) != nil || ae.Content == "" {
			return
		}
		col.text.WriteString(ae.Content)
		if onText != nil {
			onText(ae.Content)
		}
	}
}

func isToolEvent(ev kiroEvent) bool {
	if ev.eventType == "toolUseEvent" {
		return true
	}
	if ev.eventType == "assistantResponseEvent" {
		return false
	}
	// 兜底：按 payload 关键字段判断。
	return strings.Contains(string(ev.payload), "toolUseId")
}

func (acc *toolAccumulator) arguments() string {
	s := acc.input.String()
	if strings.TrimSpace(s) == "" {
		return "{}"
	}
	return s
}

func toolCallResponse(acc *toolAccumulator) dto.ToolCallResponse {
	idx := acc.index
	return dto.ToolCallResponse{
		Index: &idx,
		ID:    acc.id,
		Type:  "function",
		Function: dto.FunctionResponse{
			Name:      acc.name,
			Arguments: acc.arguments(),
		},
	}
}

// ============ 响应处理 ============

func kiroStreamHandler(c *gin.Context, info *relaycommon.RelayInfo, resp *http.Response) (*dto.Usage, *types.NewAPIError) {
	responseID := helper.GetResponseID(c)
	createdTime := common.GetTimestamp()
	model := info.UpstreamModelName

	helper.SetEventStreamHeaders(c)

	col := newCollector()
	var buf []byte
	readBuf := make([]byte, 8192)
	emittedTools := map[string]bool{}
	isFirst := true

	emit := func(choice dto.ChatCompletionsStreamResponseChoice) {
		streamResp := dto.ChatCompletionsStreamResponse{
			Id:      responseID,
			Object:  "chat.completion.chunk",
			Created: createdTime,
			Model:   model,
			Choices: []dto.ChatCompletionsStreamResponseChoice{choice},
		}
		jsonStr, err := json.Marshal(streamResp)
		if err != nil {
			return
		}
		c.Render(-1, common.CustomEvent{Data: "data: " + string(jsonStr)})
	}

	emitText := func(text string) {
		if isFirst {
			isFirst = false
			info.SetFirstResponseTime()
		}
		delta := dto.ChatCompletionsStreamResponseChoiceDelta{Role: "assistant"}
		delta.SetContentString(text)
		emit(dto.ChatCompletionsStreamResponseChoice{Delta: delta, Index: 0})
	}

	emitToolCall := func(acc *toolAccumulator) {
		if isFirst {
			isFirst = false
			info.SetFirstResponseTime()
		}
		emittedTools[acc.id] = true
		delta := dto.ChatCompletionsStreamResponseChoiceDelta{
			Role:      "assistant",
			ToolCalls: []dto.ToolCallResponse{toolCallResponse(acc)},
		}
		emit(dto.ChatCompletionsStreamResponseChoice{Delta: delta, Index: 0})
	}

	for {
		n, readErr := resp.Body.Read(readBuf)
		if n > 0 {
			buf = append(buf, readBuf[:n]...)
			var events []kiroEvent
			events, buf = parseFrames(buf)
			for _, ev := range events {
				col.handle(ev, emitText, emitToolCall)
			}
		}
		if readErr != nil {
			break
		}
	}
	service.CloseResponseBodyGracefully(resp)

	// 兜底：补发流中未显式 stop 的工具调用。
	for _, id := range col.toolOrder {
		if acc := col.tools[id]; acc.name != "" && !emittedTools[id] {
			emitToolCall(acc)
		}
	}

	finishReason := "stop"
	if len(col.toolOrder) > 0 {
		finishReason = "tool_calls"
	}

	usage := service.ResponseText2Usage(c, col.text.String(), model, info.GetEstimatePromptTokens())
	if info.ShouldIncludeUsage {
		emitUsage(c, responseID, createdTime, model, usage)
	}

	// 结束 chunk。
	emit(dto.ChatCompletionsStreamResponseChoice{
		Delta:        dto.ChatCompletionsStreamResponseChoiceDelta{},
		Index:        0,
		FinishReason: &finishReason,
	})
	c.Render(-1, common.CustomEvent{Data: "data: [DONE]"})

	return usage, nil
}

func emitUsage(c *gin.Context, id string, created int64, model string, usage *dto.Usage) {
	streamResp := dto.ChatCompletionsStreamResponse{
		Id:      id,
		Object:  "chat.completion.chunk",
		Created: created,
		Model:   model,
		Choices: []dto.ChatCompletionsStreamResponseChoice{},
		Usage:   usage,
	}
	jsonStr, err := json.Marshal(streamResp)
	if err != nil {
		return
	}
	c.Render(-1, common.CustomEvent{Data: "data: " + string(jsonStr)})
}

func kiroHandler(c *gin.Context, info *relaycommon.RelayInfo, resp *http.Response) (*dto.Usage, *types.NewAPIError) {
	model := info.UpstreamModelName
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, types.NewError(err, types.ErrorCodeBadResponseBody)
	}
	service.CloseResponseBodyGracefully(resp)

	col := newCollector()
	events, _ := parseFrames(body)
	for _, ev := range events {
		col.handle(ev, nil, nil)
	}

	message := dto.Message{Role: "assistant"}
	message.SetStringContent(col.text.String())

	finishReason := "stop"
	if len(col.toolOrder) > 0 {
		finishReason = "tool_calls"
		toolCalls := make([]dto.ToolCallResponse, 0, len(col.toolOrder))
		for _, id := range col.toolOrder {
			toolCalls = append(toolCalls, toolCallResponse(col.tools[id]))
		}
		message.SetToolCalls(toolCalls)
	}

	usage := service.ResponseText2Usage(c, col.text.String(), model, info.GetEstimatePromptTokens())

	textResp := dto.TextResponse{
		Id:      helper.GetResponseID(c),
		Object:  "chat.completion",
		Created: common.GetTimestamp(),
		Model:   model,
		Choices: []dto.OpenAITextResponseChoice{
			{
				Index:        0,
				Message:      message,
				FinishReason: finishReason,
			},
		},
		Usage: *usage,
	}

	jsonResponse, err := json.Marshal(textResp)
	if err != nil {
		return nil, types.NewError(err, types.ErrorCodeBadResponseBody)
	}
	c.Writer.Header().Set("Content-Type", "application/json")
	c.Writer.WriteHeader(http.StatusOK)
	_, _ = c.Writer.Write(jsonResponse)
	return usage, nil
}
