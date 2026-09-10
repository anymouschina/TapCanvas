package openai

import (
	"bufio"
	"bytes"
	"errors"
	"fmt"
	"net/http"
	"strings"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/dto"
)

// normalizeImageResponseBody converts an image provider's SSE envelope into
// the JSON Images API response expected by new-api. Some OpenAI-compatible
// providers use event-stream for image generation even when the request does
// not ask for streaming; the completed event still contains a standard
// {created, model, data} image response.
func normalizeImageResponseBody(resp *http.Response, body []byte) ([]byte, error) {
	if resp == nil || !strings.Contains(strings.ToLower(resp.Header.Get("Content-Type")), "text/event-stream") {
		return body, nil
	}

	var completed []byte
	var parseErr error
	found := false
	scanner := bufio.NewScanner(bytes.NewReader(body))
	scanner.Buffer(make([]byte, 4096), 4*1024*1024)
	var eventData strings.Builder
	flush := func() {
		if eventData.Len() == 0 {
			return
		}
		data := eventData.String()
		eventData.Reset()
		if data == "[DONE]" {
			return
		}
		var payload imageSSEPayload
		if err := common.Unmarshal([]byte(data), &payload); err != nil {
			parseErr = fmt.Errorf("invalid image SSE event JSON: %w", err)
			return
		}
		if len(payload.Data) > 0 {
			// Preserve the entire completed envelope, including usage and provider metadata.
			completed = []byte(data)
			found = true
		}
	}
	for scanner.Scan() {
		line := strings.TrimSuffix(scanner.Text(), "\r")
		if line == "" {
			flush()
			continue
		}
		if strings.HasPrefix(line, ":") {
			continue
		}
		if data, ok := strings.CutPrefix(line, "data:"); ok {
			if eventData.Len() > 0 {
				eventData.WriteByte('\n')
			}
			eventData.WriteString(strings.TrimSpace(data))
		}
	}
	flush()
	if err := scanner.Err(); err != nil {
		return nil, err
	}
	if !found {
		if parseErr != nil {
			return nil, parseErr
		}
		return nil, errors.New("image SSE response contains no completed image data")
	}

	resp.Header.Set("Content-Type", "application/json")
	resp.Header.Del("Content-Length")
	return completed, nil
}

type imageSSEPayload struct {
	Created int64           `json:"created,omitempty"`
	Model   string          `json:"model,omitempty"`
	Data    []dto.ImageData `json:"data"`
}
