package droid

import (
	"encoding/json"
	"errors"
	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/dto"
	"strings"
)

func textBlock(text string) (json.RawMessage, error) {
	return common.Marshal(struct {
		Type string `json:"type"`
		Text string `json:"text"`
	}{Type: "text", Text: text})
}

// withIdentity is droid's join: the line alone, or the line, one newline and
// the caller's prompt. A prompt that already opens with the line is kept.
func withIdentity(text string) string {
	switch {
	case strings.HasPrefix(text, DroidLine):
		return text
	case strings.TrimSpace(text) == "":
		return DroidLine
	}
	return DroidPrompt + text
}

// prependClaudeIdentity keeps Anthropic system blocks, the line first.
func prependClaudeIdentity(request *dto.ClaudeRequest) (*dto.ClaudeRequest, error) {
	if request == nil {
		return nil, errors.New("droid: Claude request is nil")
	}
	clone := *request
	identity, err := textBlock(DroidLine)
	if err != nil {
		return nil, err
	}
	blocks := []json.RawMessage{identity}
	if request.System != nil {
		raw, err := common.Marshal(request.System)
		if err != nil {
			return nil, err
		}
		switch common.GetJsonType(raw) {
		case "string":
			var text string
			if err := common.Unmarshal(raw, &text); err != nil {
				return nil, err
			}
			if strings.HasPrefix(text, DroidLine) {
				return &clone, nil
			}
			if strings.TrimSpace(text) != "" {
				body, err := textBlock(text)
				if err != nil {
					return nil, err
				}
				blocks = append(blocks, body)
			}
		case "array":
			var existing []json.RawMessage
			if err := common.Unmarshal(raw, &existing); err != nil {
				return nil, err
			}
			if len(existing) > 0 {
				var first struct {
					Type string `json:"type"`
					Text string `json:"text"`
				}
				if common.Unmarshal(existing[0], &first) == nil && first.Type == "text" && strings.HasPrefix(first.Text, DroidLine) {
					return &clone, nil
				}
			}
			blocks = append(blocks, existing...)
		default:
			return nil, errors.New("droid: Claude system must be a string or content block array")
		}
	}
	clone.System = blocks
	return &clone, nil
}

// Preserve annotated and mixed system content as raw blocks.
func prependChatIdentity(messages []dto.Message) ([]dto.Message, error) {
	out := append([]dto.Message(nil), messages...)
	if len(out) == 0 || (out[0].Role != "system" && out[0].Role != "developer") {
		return append([]dto.Message{{Role: "system", Content: DroidLine}}, out...), nil
	}
	first := out[0]
	if first.IsStringContent() {
		first.SetStringContent(withIdentity(first.StringContent()))
	} else {
		raw, err := common.Marshal(first.Content)
		if err != nil {
			return nil, err
		}
		if common.GetJsonType(raw) != "array" {
			return nil, errors.New("droid: Chat system content must be a string or content block array")
		}
		var parts []json.RawMessage
		if err := common.Unmarshal(raw, &parts); err != nil {
			return nil, err
		}
		if len(parts) > 0 {
			var opening struct {
				Type string `json:"type"`
				Text string `json:"text"`
			}
			if err := common.Unmarshal(parts[0], &opening); err != nil {
				return nil, err
			}
			if opening.Type == "text" && strings.HasPrefix(opening.Text, DroidLine) {
				return out, nil
			}
		}
		identity, err := textBlock(DroidLine)
		if err != nil {
			return nil, err
		}
		first.Content = append([]json.RawMessage{identity}, parts...)
	}
	out[0] = first
	return out, nil
}
