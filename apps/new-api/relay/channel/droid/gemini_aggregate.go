package droid

import (
	"bufio"
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"sort"
	"strings"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/service"
)

type geminiCandidateAggregate struct {
	fields   map[string]json.RawMessage
	content  map[string]json.RawMessage
	parts    []json.RawMessage
	finished bool
}

// aggregateGeminiStream only changes transport. It preserves raw part fields,
// including real thoughtSignature, tool calls, unknown media and usage metadata.
// A truncated stream never becomes a successful JSON completion.
func aggregateGeminiStream(response *http.Response) (*http.Response, error) {
	if response == nil || response.Body == nil {
		return nil, fmt.Errorf("droid: missing Gemini response body")
	}
	if !strings.HasPrefix(response.Header.Get("Content-Type"), "text/event-stream") {
		return response, nil
	}
	defer service.CloseResponseBodyGracefully(response)
	envelope := map[string]json.RawMessage{}
	candidates := map[int]*geminiCandidateAggregate{}
	consume := func(data string) error {
		if data == "[DONE]" {
			return nil
		}
		var chunk map[string]json.RawMessage
		if err := common.UnmarshalJsonStr(data, &chunk); err != nil {
			return fmt.Errorf("droid: invalid Gemini SSE JSON: %w", err)
		}
		if failure := chunk["error"]; len(failure) > 0 && string(failure) != "null" {
			return fmt.Errorf("droid: Gemini SSE upstream error: %s", failure)
		}
		for key, value := range chunk {
			if key != "candidates" {
				envelope[key] = value
			}
		}
		var incoming []map[string]json.RawMessage
		if raw := chunk["candidates"]; len(raw) > 0 {
			if err := common.Unmarshal(raw, &incoming); err != nil {
				return fmt.Errorf("droid: invalid Gemini candidates: %w", err)
			}
		}
		for position, fields := range incoming {
			index := position
			if raw := fields["index"]; len(raw) > 0 {
				if err := common.Unmarshal(raw, &index); err != nil || index < 0 {
					return fmt.Errorf("droid: invalid Gemini candidate index")
				}
			}
			candidate := candidates[index]
			if candidate == nil {
				candidate = &geminiCandidateAggregate{fields: map[string]json.RawMessage{}, content: map[string]json.RawMessage{}}
				candidates[index] = candidate
			}
			for key, value := range fields {
				if key != "content" {
					candidate.fields[key] = value
				}
			}
			if raw := fields["finishReason"]; len(raw) > 0 {
				var reason string
				if err := common.Unmarshal(raw, &reason); err != nil {
					return fmt.Errorf("droid: invalid Gemini finish reason: %w", err)
				}
				candidate.finished = reason != ""
			}
			if raw := fields["content"]; len(raw) > 0 && string(raw) != "null" {
				var content map[string]json.RawMessage
				if err := common.Unmarshal(raw, &content); err != nil {
					return fmt.Errorf("droid: invalid Gemini content: %w", err)
				}
				for key, value := range content {
					if key != "parts" {
						candidate.content[key] = value
					}
				}
				var parts []json.RawMessage
				if raw := content["parts"]; len(raw) > 0 {
					if err := common.Unmarshal(raw, &parts); err != nil {
						return fmt.Errorf("droid: invalid Gemini content parts: %w", err)
					}
				}
				for _, part := range parts {
					hasData, err := geminiAggregatePartHasData(part)
					if err != nil {
						return err
					}
					if hasData {
						candidate.parts = append(candidate.parts, part)
					}
				}
			}
		}
		return nil
	}
	reader := bufio.NewReader(response.Body)
	var frame []string
	flush := func() error {
		if len(frame) == 0 {
			return nil
		}
		data := strings.Join(frame, "\n")
		frame = nil
		return consume(data)
	}
	for {
		line, err := reader.ReadString('\n')
		line = strings.TrimSuffix(strings.TrimSuffix(line, "\n"), "\r")
		if line == "" {
			if parseErr := flush(); parseErr != nil {
				return nil, parseErr
			}
		} else if strings.HasPrefix(line, "data:") {
			frame = append(frame, strings.TrimPrefix(strings.TrimPrefix(line, "data:"), " "))
		}
		if err != nil {
			if err != io.EOF {
				return nil, fmt.Errorf("droid: reading Gemini SSE failed: %w", err)
			}
			if parseErr := flush(); parseErr != nil {
				return nil, parseErr
			}
			break
		}
	}
	indices := make([]int, 0, len(candidates))
	for index := range candidates {
		indices = append(indices, index)
	}
	sort.Ints(indices)
	complete := make([]map[string]json.RawMessage, 0, len(indices))
	for _, index := range indices {
		candidate := candidates[index]
		if !candidate.finished {
			return nil, fmt.Errorf("droid: Gemini stream ended without finishReason for candidate %d", index)
		}
		parts, err := common.Marshal(candidate.parts)
		if err != nil {
			return nil, err
		}
		candidate.content["parts"] = parts
		content, err := common.Marshal(candidate.content)
		if err != nil {
			return nil, err
		}
		candidate.fields["content"] = content
		complete = append(complete, candidate.fields)
	}
	if len(complete) == 0 {
		var feedback struct {
			BlockReason string `json:"blockReason"`
		}
		if err := common.Unmarshal(envelope["promptFeedback"], &feedback); err != nil || feedback.BlockReason == "" {
			return nil, fmt.Errorf("droid: Gemini SSE contained no completed candidates or prompt block evidence")
		}
	}
	raw, err := common.Marshal(complete)
	if err != nil {
		return nil, err
	}
	envelope["candidates"] = raw
	body, err := common.Marshal(envelope)
	if err != nil {
		return nil, err
	}
	clone := new(http.Response)
	*clone = *response
	clone.Header = response.Header.Clone()
	clone.Header.Set("Content-Type", "application/json")
	clone.Header.Del("Content-Length")
	clone.Header.Del("Transfer-Encoding")
	clone.Body = io.NopCloser(bytes.NewReader(body))
	clone.ContentLength = int64(len(body))
	clone.TransferEncoding = nil
	return clone, nil
}

// Empty terminal SSE parts carry no content and cannot be replayed through a
// request DTO whose empty text is omitted. Preserve every metadata-bearing part
// byte-for-byte, including signatures and unknown future fields.
func geminiAggregatePartHasData(part json.RawMessage) (bool, error) {
	if common.GetJsonType(part) != "object" {
		return false, fmt.Errorf("droid: invalid Gemini content part: expected object")
	}
	var fields map[string]json.RawMessage
	if err := common.Unmarshal(part, &fields); err != nil {
		return false, fmt.Errorf("droid: invalid Gemini content part: %w", err)
	}
	if len(fields) == 0 {
		return false, nil
	}
	if raw, exists := fields["text"]; exists {
		if common.GetJsonType(raw) != "string" {
			return false, fmt.Errorf("droid: invalid Gemini content part: text must be a string")
		}
		var text string
		if err := common.Unmarshal(raw, &text); err != nil {
			return false, fmt.Errorf("droid: invalid Gemini content part text: %w", err)
		}
		if len(fields) == 1 && text == "" {
			return false, nil
		}
	}
	return true, nil
}
