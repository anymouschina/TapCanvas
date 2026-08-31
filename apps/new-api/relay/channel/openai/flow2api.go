package openai

import (
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/dto"
	"github.com/QuantumNous/new-api/relay/channel/imageutil"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	"github.com/QuantumNous/new-api/relay/helper"
	"github.com/QuantumNous/new-api/service"
	"github.com/QuantumNous/new-api/types"
	"github.com/gin-gonic/gin"
)

const flow2APIDefaultAspectRatio = "16:9"

type flow2APIImageConfig struct {
	AspectRatio      string `json:"aspectRatio,omitempty"`
	AspectRatioSnake string `json:"aspect_ratio,omitempty"`
	ImageSize        string `json:"imageSize,omitempty"`
	ImageSizeSnake   string `json:"image_size,omitempty"`
	Resolution       string `json:"resolution,omitempty"`
}

type flow2APIRequestMetadata struct {
	Size             string `json:"size,omitempty"`
	AspectRatio      string `json:"aspectRatio,omitempty"`
	AspectRatioSnake string `json:"aspect_ratio,omitempty"`
	ImageSize        string `json:"imageSize,omitempty"`
	ImageSizeSnake   string `json:"image_size,omitempty"`
	Resolution       string `json:"resolution,omitempty"`
}

type flow2APIExtraBody struct {
	Google struct {
		ImageConfig      flow2APIImageConfig `json:"image_config,omitempty"`
		ImageConfigCamel flow2APIImageConfig `json:"imageConfig,omitempty"`
	} `json:"google,omitempty"`
}

type flow2APIChatMessage struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}

type flow2APIChatRequest struct {
	Model    string                `json:"model"`
	Messages []flow2APIChatMessage `json:"messages"`
	Stream   bool                  `json:"stream"`
}

func isFlow2APIProtocol(info *relaycommon.RelayInfo) bool {
	return info != nil && info.ProtocolID == constant.ProtocolFlow2API
}

func flow2APIImageRequestSpec(request dto.ImageRequest) (string, string) {
	aspectRatio := strings.TrimSpace(request.Size)
	if aspectRatio == "" {
		aspectRatio = firstImageRequestExtra(request, "aspectRatio", "aspect_ratio")
	}
	resolution := firstImageRequestExtra(request, "resolution", "imageSize", "image_size")

	metadata := parseFlow2APIMetadata(request.Extra["metadata"])
	if aspectRatio == "" {
		aspectRatio = firstNonEmpty(metadata.AspectRatio, metadata.AspectRatioSnake, metadata.Size)
	}
	if resolution == "" {
		resolution = firstNonEmpty(metadata.Resolution, metadata.ImageSize, metadata.ImageSizeSnake)
	}
	if resolution == "" {
		switch strings.ToLower(strings.TrimSpace(request.Quality)) {
		case "high", "hd", "2k":
			resolution = "2K"
		case "4k":
			resolution = "4K"
		}
	}
	return aspectRatio, resolution
}

func flow2APIChatRequestSpec(request *dto.GeneralOpenAIRequest) (string, string) {
	if request == nil {
		return "", ""
	}
	aspectRatio := strings.TrimSpace(request.Size)
	metadata := parseFlow2APIMetadata(request.Metadata)
	if aspectRatio == "" {
		aspectRatio = firstNonEmpty(metadata.AspectRatio, metadata.AspectRatioSnake, metadata.Size)
	}
	resolution := firstNonEmpty(metadata.Resolution, metadata.ImageSize, metadata.ImageSizeSnake)

	if len(request.ExtraBody) > 0 {
		var extraBody flow2APIExtraBody
		if err := common.Unmarshal(request.ExtraBody, &extraBody); err == nil {
			imageConfig := extraBody.Google.ImageConfig
			if isEmptyFlow2APIImageConfig(imageConfig) {
				imageConfig = extraBody.Google.ImageConfigCamel
			}
			if aspectRatio == "" {
				aspectRatio = firstNonEmpty(imageConfig.AspectRatio, imageConfig.AspectRatioSnake)
			}
			if resolution == "" {
				resolution = firstNonEmpty(imageConfig.Resolution, imageConfig.ImageSize, imageConfig.ImageSizeSnake)
			}
		}
	}
	return aspectRatio, resolution
}

func firstImageRequestExtra(request dto.ImageRequest, keys ...string) string {
	for _, key := range keys {
		raw := request.Extra[key]
		if len(raw) == 0 {
			continue
		}
		var value string
		if err := common.Unmarshal(raw, &value); err == nil && strings.TrimSpace(value) != "" {
			return strings.TrimSpace(value)
		}
	}
	return ""
}

func parseFlow2APIMetadata(raw []byte) flow2APIRequestMetadata {
	metadata := flow2APIRequestMetadata{}
	if len(raw) == 0 {
		return metadata
	}
	_ = common.Unmarshal(raw, &metadata)
	return metadata
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if trimmed := strings.TrimSpace(value); trimmed != "" {
			return trimmed
		}
	}
	return ""
}

func isEmptyFlow2APIImageConfig(config flow2APIImageConfig) bool {
	return config.AspectRatio == "" &&
		config.AspectRatioSnake == "" &&
		config.ImageSize == "" &&
		config.ImageSizeSnake == "" &&
		config.Resolution == ""
}

func resolveFlow2APIImageModel(c *gin.Context, info *relaycommon.RelayInfo, aspectRatio string, resolution string) (string, error) {
	if info == nil {
		return "", errors.New("flow2api relay info is required")
	}
	modelPrefix := strings.TrimSpace(info.ProtocolOptions["image_variant_model"])
	if modelPrefix == "" {
		return "", errors.New("flow2api protocol option image_variant_model is required")
	}
	aspectVariant, err := normalizeFlow2APIAspectVariant(aspectRatio)
	if err != nil {
		return "", err
	}
	resolutionSuffix, err := normalizeFlow2APIResolutionSuffix(resolution)
	if err != nil {
		return "", err
	}

	logicalModel := modelPrefix + "-" + aspectVariant + resolutionSuffix
	mappedModel, mapped, err := helper.MapModelName(c.GetString("model_mapping"), logicalModel)
	if err != nil {
		return "", err
	}
	if !mapped || strings.TrimSpace(mappedModel) == logicalModel {
		return "", fmt.Errorf("flow2api model_mapping is missing image variant %q", logicalModel)
	}
	info.UpstreamModelName = mappedModel
	info.IsModelMapped = true
	return mappedModel, nil
}

func normalizeFlow2APIAspectVariant(value string) (string, error) {
	normalized := strings.ToLower(strings.ReplaceAll(strings.TrimSpace(value), " ", ""))
	switch normalized {
	case "", flow2APIDefaultAspectRatio, "landscape", "1792x1024", "1536x1024", "1920x1080", "3840x2160":
		return "landscape", nil
	case "9:16", "portrait", "1024x1792", "1024x1536", "1080x1920", "2160x3840":
		return "portrait", nil
	case "1:1", "square", "256x256", "512x512", "1024x1024", "2048x2048", "4096x4096":
		return "square", nil
	case "4:3", "4x3", "four-three", "1024x768", "2048x1536", "4096x3072":
		return "4x3", nil
	case "3:4", "3x4", "three-four", "768x1024", "1536x2048", "3072x4096":
		return "3x4", nil
	default:
		return "", fmt.Errorf("flow2api unsupported image aspect ratio %q; allowed: 16:9, 9:16, 1:1, 4:3, 3:4", value)
	}
}

func normalizeFlow2APIResolutionSuffix(value string) (string, error) {
	switch strings.ToUpper(strings.TrimSpace(value)) {
	case "", "1K", "1080P":
		return "", nil
	case "2K":
		return "-2k", nil
	case "4K":
		return "-4k", nil
	default:
		return "", fmt.Errorf("flow2api unsupported image resolution %q; allowed: 1K, 2K, 4K", value)
	}
}

func convertFlow2APIImageRequest(c *gin.Context, info *relaycommon.RelayInfo, request dto.ImageRequest) (flow2APIChatRequest, error) {
	if request.N != nil && *request.N != 1 {
		return flow2APIChatRequest{}, fmt.Errorf("flow2api image generation requires n=1, got %d", *request.N)
	}
	aspectRatio, resolution := flow2APIImageRequestSpec(request)
	upstreamModel, err := resolveFlow2APIImageModel(c, info, aspectRatio, resolution)
	if err != nil {
		return flow2APIChatRequest{}, err
	}
	return flow2APIChatRequest{
		Model: upstreamModel,
		Messages: []flow2APIChatMessage{
			{Role: "user", Content: request.Prompt},
		},
		Stream: false,
	}, nil
}

func applyFlow2APIChatModel(c *gin.Context, info *relaycommon.RelayInfo, request *dto.GeneralOpenAIRequest) error {
	aspectRatio, resolution := flow2APIChatRequestSpec(request)
	upstreamModel, err := resolveFlow2APIImageModel(c, info, aspectRatio, resolution)
	if err != nil {
		return err
	}
	request.Model = upstreamModel
	return nil
}

func flow2APIImageHandler(c *gin.Context, info *relaycommon.RelayInfo, resp *http.Response) (*dto.Usage, *types.NewAPIError) {
	responseBody, readErr := io.ReadAll(resp.Body)
	if readErr != nil {
		return nil, types.NewOpenAIError(readErr, types.ErrorCodeBadResponseBody, http.StatusInternalServerError)
	}
	service.CloseResponseBodyGracefully(resp)

	var flowResponse dto.OpenAITextResponse
	if err := common.Unmarshal(responseBody, &flowResponse); err != nil {
		return nil, types.NewOpenAIError(err, types.ErrorCodeBadResponseBody, http.StatusInternalServerError)
	}
	if openAIError := flowResponse.GetOpenAIError(); openAIError != nil && openAIError.Type != "" {
		return nil, types.WithOpenAIError(*openAIError, resp.StatusCode)
	}

	imageData := make([]dto.ImageData, 0)
	seenURLs := make(map[string]struct{})
	for _, choice := range flowResponse.Choices {
		for _, imageURL := range imageutil.ExtractHTTPMarkdownImageURLs(choice.Message.StringContent()) {
			if _, exists := seenURLs[imageURL]; exists {
				continue
			}
			seenURLs[imageURL] = struct{}{}
			imageData = append(imageData, dto.ImageData{Url: imageURL})
		}
	}
	if len(imageData) == 0 {
		return nil, types.NewOpenAIError(errors.New("flow2api response contains no HTTP Markdown image"), types.ErrorCodeBadResponseBody, http.StatusBadGateway)
	}

	imageResponse := dto.ImageResponse{Created: common.GetTimestamp(), Data: imageData}
	responseJSON, err := common.Marshal(imageResponse)
	if err != nil {
		return nil, types.NewOpenAIError(err, types.ErrorCodeBadResponseBody, http.StatusInternalServerError)
	}
	c.Writer.Header().Set("Content-Type", "application/json")
	c.Writer.WriteHeader(resp.StatusCode)
	_, _ = c.Writer.Write(responseJSON)

	usage := flowResponse.Usage
	if usage.TotalTokens <= 0 {
		const generatedImageTokens = 258
		usage.PromptTokens = generatedImageTokens * len(imageData)
		usage.TotalTokens = usage.PromptTokens
	}
	return &usage, nil
}
