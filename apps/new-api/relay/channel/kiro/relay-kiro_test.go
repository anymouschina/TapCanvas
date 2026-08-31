package kiro

import (
	"encoding/binary"
	"testing"

	"github.com/QuantumNous/new-api/dto"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
)

// buildFrame 按 AWS event-stream 帧格式打包一条消息（CRC 用 0 占位，解析侧不校验）。
func buildFrame(eventType string, payload []byte) []byte {
	// header: [nameLen:1][name][type=7:1][valLen:2][value]
	name := ":event-type"
	var headers []byte
	headers = append(headers, byte(len(name)))
	headers = append(headers, name...)
	headers = append(headers, 7)
	vl := make([]byte, 2)
	binary.BigEndian.PutUint16(vl, uint16(len(eventType)))
	headers = append(headers, vl...)
	headers = append(headers, eventType...)

	total := 12 + len(headers) + len(payload) + 4
	frame := make([]byte, 0, total)
	prelude := make([]byte, 12)
	binary.BigEndian.PutUint32(prelude[0:4], uint32(total))
	binary.BigEndian.PutUint32(prelude[4:8], uint32(len(headers)))
	// prelude crc (4) 占位 0
	frame = append(frame, prelude...)
	frame = append(frame, headers...)
	frame = append(frame, payload...)
	frame = append(frame, 0, 0, 0, 0) // msg crc 占位
	return frame
}

func TestParseFramesAndCollect(t *testing.T) {
	var stream []byte
	stream = append(stream, buildFrame("assistantResponseEvent", []byte(`{"content":"Hello, "}`))...)
	stream = append(stream, buildFrame("assistantResponseEvent", []byte(`{"content":"world"}`))...)
	stream = append(stream, buildFrame("toolUseEvent", []byte(`{"toolUseId":"t1","name":"get_weather","input":"{\"city\":\"SF\"}","stop":true}`))...)

	events, rest := parseFrames(stream)
	if len(rest) != 0 {
		t.Fatalf("expected no leftover bytes, got %d", len(rest))
	}
	if len(events) != 3 {
		t.Fatalf("expected 3 events, got %d", len(events))
	}

	col := newCollector()
	for _, ev := range events {
		col.handle(ev, nil, nil)
	}
	if got := col.text.String(); got != "Hello, world" {
		t.Fatalf("text = %q, want %q", got, "Hello, world")
	}
	if len(col.toolOrder) != 1 {
		t.Fatalf("expected 1 tool, got %d", len(col.toolOrder))
	}
	acc := col.tools[col.toolOrder[0]]
	if acc.name != "get_weather" {
		t.Fatalf("tool name = %q", acc.name)
	}
	if acc.arguments() != `{"city":"SF"}` {
		t.Fatalf("tool args = %q", acc.arguments())
	}
}

func TestParseFramesPartial(t *testing.T) {
	full := buildFrame("assistantResponseEvent", []byte(`{"content":"hi"}`))
	// 只喂入前一半，应解析出 0 帧并把全部字节作为 rest 保留。
	events, rest := parseFrames(full[:len(full)-3])
	if len(events) != 0 {
		t.Fatalf("expected 0 events on partial frame, got %d", len(events))
	}
	if len(rest) != len(full)-3 {
		t.Fatalf("expected rest to retain partial bytes")
	}
}

func TestConvertOpenAIRequestFlatten(t *testing.T) {
	info := &relaycommon.RelayInfo{ChannelMeta: &relaycommon.ChannelMeta{UpstreamModelName: "glm-5"}}
	req := &dto.GeneralOpenAIRequest{
		Model: "glm-5",
		Messages: []dto.Message{
			{Role: "system", Content: "You are helpful."},
			{Role: "user", Content: "Hi"},
			{Role: "assistant", Content: "Hello!"},
			{Role: "user", Content: "What's 2+2?"},
		},
	}
	w := convertOpenAIRequest(info, req)
	cs := w.ConversationState
	if cs.CurrentMessage.UserInputMessage == nil {
		t.Fatal("current message must be userInputMessage")
	}
	if cs.CurrentMessage.UserInputMessage.Content != "What's 2+2?" {
		t.Fatalf("current content = %q", cs.CurrentMessage.UserInputMessage.Content)
	}
	if cs.CurrentMessage.UserInputMessage.ModelID != "glm-5" {
		t.Fatalf("modelId = %q", cs.CurrentMessage.UserInputMessage.ModelID)
	}
	if len(cs.History) != 2 {
		t.Fatalf("expected 2 history msgs, got %d", len(cs.History))
	}
	// system prompt 应被并入第一条 user 消息。
	first := cs.History[0].UserInputMessage
	if first == nil || first.Content != "You are helpful.\n\nHi" {
		t.Fatalf("system merge failed: %+v", first)
	}
}

func TestConvertToolResults(t *testing.T) {
	info := &relaycommon.RelayInfo{ChannelMeta: &relaycommon.ChannelMeta{UpstreamModelName: "glm-5"}}
	asstToolCalls := `[{"id":"call_1","type":"function","function":{"name":"get_weather","arguments":"{}"}}]`
	req := &dto.GeneralOpenAIRequest{
		Model: "glm-5",
		Messages: []dto.Message{
			{Role: "user", Content: "weather?"},
			{Role: "assistant", Content: "", ToolCalls: []byte(asstToolCalls)},
			{Role: "tool", ToolCallId: "call_1", Content: "sunny"},
		},
	}
	w := convertOpenAIRequest(info, req)
	cur := w.ConversationState.CurrentMessage.UserInputMessage
	if cur == nil || cur.UserInputMessageContext == nil {
		t.Fatal("current message should carry tool results")
	}
	if len(cur.UserInputMessageContext.ToolResults) != 1 {
		t.Fatalf("expected 1 tool result, got %d", len(cur.UserInputMessageContext.ToolResults))
	}
	tr := cur.UserInputMessageContext.ToolResults[0]
	if tr.ToolUseID != "call_1" || tr.Content[0].Text != "sunny" {
		t.Fatalf("tool result wrong: %+v", tr)
	}
	// assistant 的 toolUses 应在 history 中。
	var foundToolUse bool
	for _, h := range w.ConversationState.History {
		if h.AssistantResponseMessage != nil && len(h.AssistantResponseMessage.ToolUses) == 1 {
			foundToolUse = true
		}
	}
	if !foundToolUse {
		t.Fatal("assistant toolUses not found in history")
	}
}
