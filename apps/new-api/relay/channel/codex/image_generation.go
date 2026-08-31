package codex

import (
	"bufio"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/dto"
	"github.com/QuantumNous/new-api/service"
	"github.com/QuantumNous/new-api/types"
	"github.com/gin-gonic/gin"
)

const codexImageMainModel = "gpt-5.4-mini"

type codexImageTool struct {
	Type              string          `json:"type"`
	Action            string          `json:"action"`
	Model             string          `json:"model"`
	Size              string          `json:"size,omitempty"`
	Quality           string          `json:"quality,omitempty"`
	Background        json.RawMessage `json:"background,omitempty"`
	OutputFormat      json.RawMessage `json:"output_format,omitempty"`
	Moderation        json.RawMessage `json:"moderation,omitempty"`
	OutputCompression json.RawMessage `json:"output_compression,omitempty"`
	PartialImages     json.RawMessage `json:"partial_images,omitempty"`
}

type codexImageInputContent struct {
	Type     string `json:"type"`
	Text     string `json:"text,omitempty"`
	ImageURL string `json:"image_url,omitempty"`
}

type codexImageInput struct {
	Type    string                   `json:"type"`
	Role    string                   `json:"role"`
	Content []codexImageInputContent `json:"content"`
}

type codexImageResponsesRequest struct {
	Instructions      string            `json:"instructions"`
	Stream            bool              `json:"stream"`
	ParallelToolCalls bool              `json:"parallel_tool_calls"`
	Include           []string          `json:"include"`
	Model             string            `json:"model"`
	Store             bool              `json:"store"`
	Input             []codexImageInput `json:"input"`
	Tools             []codexImageTool  `json:"tools"`
	ToolChoice        map[string]string `json:"tool_choice"`
}

func convertCodexImageGenerationRequest(request dto.ImageRequest) (codexImageResponsesRequest, error) {
	if request.Model != "gpt-image-2" {
		return codexImageResponsesRequest{}, fmt.Errorf("codex channel: unsupported image model %q", request.Model)
	}
	if request.N != nil && *request.N != 1 {
		return codexImageResponsesRequest{}, errors.New("codex channel: gpt-image-2 currently requires n=1")
	}
	referenceImages, err := extractCodexReferenceImages(request.Extra)
	if err != nil {
		return codexImageResponsesRequest{}, err
	}
	content := make([]codexImageInputContent, 0, 1+len(referenceImages))
	content = append(content, codexImageInputContent{Type: "input_text", Text: request.Prompt})
	for _, imageURL := range referenceImages {
		content = append(content, codexImageInputContent{Type: "input_image", ImageURL: imageURL})
	}
	action := "generate"
	if len(referenceImages) > 0 {
		action = "edit"
	}
	tool := codexImageTool{
		Type:              "image_generation",
		Action:            action,
		Model:             "gpt-image-2",
		Size:              normalizeCodexImageSize(request.Size),
		Quality:           request.Quality,
		Background:        request.Background,
		OutputFormat:      request.OutputFormat,
		Moderation:        request.Moderation,
		OutputCompression: request.OutputCompression,
		PartialImages:     request.PartialImages,
	}
	return codexImageResponsesRequest{
		Instructions:      "",
		Stream:            true,
		ParallelToolCalls: true,
		Include:           []string{"reasoning.encrypted_content"},
		Model:             codexImageMainModel,
		Store:             false,
		Input: []codexImageInput{{
			Type:    "message",
			Role:    "user",
			Content: content,
		}},
		Tools:      []codexImageTool{tool},
		ToolChoice: map[string]string{"type": "image_generation"},
	}, nil
}

func extractCodexReferenceImages(extra map[string]json.RawMessage) ([]string, error) {
	urls := make([]string, 0)
	seen := make(map[string]struct{})
	for _, field := range []string{"images", "image_urls"} {
		raw, exists := extra[field]
		if !exists {
			continue
		}
		var values []string
		if len(raw) == 0 || json.Unmarshal(raw, &values) != nil || values == nil {
			return nil, fmt.Errorf("codex channel: %s must be an array of non-empty strings", field)
		}
		for index, value := range values {
			value = strings.TrimSpace(value)
			if value == "" {
				return nil, fmt.Errorf("codex channel: %s[%d] must be a non-empty string", field, index)
			}
			if _, exists := seen[value]; exists {
				continue
			}
			seen[value] = struct{}{}
			urls = append(urls, value)
		}
	}
	return urls, nil
}

func normalizeCodexImageSize(size string) string {
	switch strings.TrimSpace(size) {
	case "16:9", "3:2", "4:3", "21:9":
		return "1536x1024"
	case "9:16", "2:3", "3:4", "9:21":
		return "1024x1536"
	case "":
		return "1024x1024"
	default:
		return strings.TrimSpace(size)
	}
}

func handleCodexImageGenerationResponse(c *gin.Context, resp *http.Response) (*dto.Usage, *types.NewAPIError) {
	if resp == nil || resp.Body == nil {
		return nil, types.NewError(errors.New("codex image generation: empty upstream response"), types.ErrorCodeBadResponse)
	}
	defer service.CloseResponseBodyGracefully(resp)

	scanner := bufio.NewScanner(resp.Body)
	scanner.Buffer(make([]byte, 64*1024), 32*1024*1024)
	var completed map[string]interface{}
	collectedOutputs := make([]map[string]interface{}, 0, 1)
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if !strings.HasPrefix(line, "data:") {
			continue
		}
		data := strings.TrimSpace(strings.TrimPrefix(line, "data:"))
		if data == "" || data == "[DONE]" {
			continue
		}
		var event map[string]interface{}
		if err := common.UnmarshalJsonStr(data, &event); err != nil {
			continue
		}
		eventType, _ := event["type"].(string)
		if eventType == "response.output_item.done" {
			if item, ok := event["item"].(map[string]interface{}); ok {
				collectedOutputs = append(collectedOutputs, item)
			}
		}
		if eventType == "response.completed" {
			completed = event
		}
	}
	if err := scanner.Err(); err != nil {
		return nil, types.NewError(fmt.Errorf("codex image generation stream read failed: %w", err), types.ErrorCodeBadResponseBody)
	}
	if completed == nil {
		return nil, types.NewError(errors.New("codex image generation ended without response.completed"), types.ErrorCodeBadResponseBody)
	}

	response, _ := completed["response"].(map[string]interface{})
	outputs, _ := response["output"].([]interface{})
	if len(outputs) == 0 && len(collectedOutputs) > 0 {
		outputs = make([]interface{}, 0, len(collectedOutputs))
		for _, output := range collectedOutputs {
			outputs = append(outputs, output)
		}
	}
	data := make([]dto.ImageData, 0, 1)
	for _, rawOutput := range outputs {
		output, _ := rawOutput.(map[string]interface{})
		if outputType, _ := output["type"].(string); outputType != "image_generation_call" {
			continue
		}
		result, _ := output["result"].(string)
		if strings.TrimSpace(result) == "" {
			continue
		}
		revisedPrompt, _ := output["revised_prompt"].(string)
		imageData := dto.ImageData{B64Json: result, RevisedPrompt: revisedPrompt}
		if c.GetString("codex_image_response_format") == "url" {
			outputFormat, _ := output["output_format"].(string)
			imageData.Url = "data:" + codexImageMIMEType(outputFormat) + ";base64," + result
			imageData.B64Json = ""
		}
		data = append(data, imageData)
	}
	if len(data) == 0 {
		return nil, types.NewError(errors.New("codex image generation completed without image result"), types.ErrorCodeBadResponseBody)
	}

	createdAt := time.Now().Unix()
	if value, ok := response["created_at"].(float64); ok && value > 0 {
		createdAt = int64(value)
	}
	c.Writer.Header().Set("Content-Type", "application/json")
	responseBody, err := common.Marshal(dto.ImageResponse{Created: createdAt, Data: data})
	if err != nil {
		return nil, types.NewError(err, types.ErrorCodeBadResponseBody)
	}
	service.IOCopyBytesGracefully(c, nil, responseBody)

	usage := &dto.Usage{TotalTokens: 1}
	if usageRaw, ok := response["usage"].(map[string]interface{}); ok {
		usage.PromptTokens = numberAsInt(usageRaw["input_tokens"])
		usage.CompletionTokens = numberAsInt(usageRaw["output_tokens"])
		usage.TotalTokens = numberAsInt(usageRaw["total_tokens"])
		if usage.TotalTokens == 0 {
			usage.TotalTokens = usage.PromptTokens + usage.CompletionTokens
		}
	}
	return usage, nil
}

func codexImageMIMEType(outputFormat string) string {
	switch strings.ToLower(strings.TrimSpace(outputFormat)) {
	case "jpeg", "jpg":
		return "image/jpeg"
	case "webp":
		return "image/webp"
	default:
		return "image/png"
	}
}

func numberAsInt(value interface{}) int {
	number, _ := value.(float64)
	return int(number)
}
