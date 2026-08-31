package codex

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/QuantumNous/new-api/dto"
	"github.com/gin-gonic/gin"
)

func TestConvertCodexImageGenerationRequest(t *testing.T) {
	one := uint(1)
	converted, err := convertCodexImageGenerationRequest(dto.ImageRequest{
		Model: "gpt-image-2", Prompt: "a red fox", N: &one, Size: "16:9", Quality: "high",
	})
	if err != nil {
		t.Fatalf("convert error = %v", err)
	}
	if converted.Model != codexImageMainModel || !converted.Stream {
		t.Fatalf("model/stream = %q/%v", converted.Model, converted.Stream)
	}
	if len(converted.Tools) != 1 || converted.Tools[0].Model != "gpt-image-2" || converted.Tools[0].Size != "1536x1024" {
		t.Fatalf("tool = %#v", converted.Tools)
	}
	if converted.Tools[0].Action != "generate" {
		t.Fatalf("tool action = %q", converted.Tools[0].Action)
	}
	if len(converted.Input) != 1 || len(converted.Input[0].Content) != 1 || converted.Input[0].Content[0].Type != "input_text" {
		t.Fatalf("input = %#v", converted.Input)
	}
	if converted.ToolChoice["type"] != "image_generation" {
		t.Fatalf("tool choice = %#v", converted.ToolChoice)
	}
}

func TestConvertCodexImageGenerationIncludesDeduplicatedReferences(t *testing.T) {
	one := uint(1)
	converted, err := convertCodexImageGenerationRequest(dto.ImageRequest{
		Model:  "gpt-image-2",
		Prompt: "an apple",
		N:      &one,
		Extra: map[string]json.RawMessage{
			"images":     json.RawMessage(`["https://example.com/a.png","https://example.com/a.png"]`),
			"image_urls": json.RawMessage(`["https://example.com/b.png","https://example.com/a.png"]`),
		},
	})
	if err != nil {
		t.Fatalf("convert error = %v", err)
	}
	if converted.Tools[0].Action != "edit" {
		t.Fatalf("tool action = %q", converted.Tools[0].Action)
	}
	content := converted.Input[0].Content
	if len(content) != 3 {
		t.Fatalf("content = %#v", content)
	}
	if content[0].Type != "input_text" || content[1].Type != "input_image" || content[1].ImageURL != "https://example.com/a.png" || content[2].ImageURL != "https://example.com/b.png" {
		t.Fatalf("content = %#v", content)
	}
}

func TestConvertCodexImageGenerationRejectsInvalidReferences(t *testing.T) {
	tests := map[string]json.RawMessage{
		"object": json.RawMessage(`{"url":"https://example.com/a.png"}`),
		"null":   json.RawMessage(`null`),
		"empty":  json.RawMessage(`[""]`),
	}
	for name, raw := range tests {
		t.Run(name, func(t *testing.T) {
			_, err := convertCodexImageGenerationRequest(dto.ImageRequest{
				Model: "gpt-image-2", Prompt: "x", Extra: map[string]json.RawMessage{"images": raw},
			})
			if err == nil {
				t.Fatal("invalid images error = nil")
			}
		})
	}
}

func TestConvertCodexImageGenerationRejectsMultipleImages(t *testing.T) {
	two := uint(2)
	if _, err := convertCodexImageGenerationRequest(dto.ImageRequest{Model: "gpt-image-2", Prompt: "x", N: &two}); err == nil {
		t.Fatal("n=2 error = nil")
	}
}

func TestHandleCodexImageGenerationResponse(t *testing.T) {
	gin.SetMode(gin.TestMode)
	recorder := httptest.NewRecorder()
	ctx, _ := gin.CreateTestContext(recorder)
	ctx.Set("codex_image_response_format", "url")
	body := "data: {\"type\":\"response.output_item.done\",\"item\":{\"type\":\"image_generation_call\",\"result\":\"AA==\",\"output_format\":\"png\"}}\n\n" +
		"data: {\"type\":\"response.completed\",\"response\":{\"created_at\":123,\"output\":[],\"usage\":{\"input_tokens\":2,\"output_tokens\":3,\"total_tokens\":5}}}\n\n"
	resp := &http.Response{StatusCode: http.StatusOK, Body: io.NopCloser(strings.NewReader(body)), Header: make(http.Header)}
	usage, apiErr := handleCodexImageGenerationResponse(ctx, resp)
	if apiErr != nil {
		t.Fatalf("handler error = %v", apiErr)
	}
	if usage.TotalTokens != 5 {
		t.Fatalf("usage = %#v", usage)
	}
	if !strings.Contains(recorder.Body.String(), `"url":"data:image/png;base64,AA=="`) {
		t.Fatalf("response = %s", recorder.Body.String())
	}
}
