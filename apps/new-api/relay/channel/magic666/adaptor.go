package magic666

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/dto"
	"github.com/QuantumNous/new-api/relay/channel"
	"github.com/QuantumNous/new-api/relay/channel/gemini"
	"github.com/QuantumNous/new-api/relay/channel/imageutil"
	"github.com/QuantumNous/new-api/relay/channel/openai"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	"github.com/QuantumNous/new-api/relay/constant"
	"github.com/QuantumNous/new-api/types"
	"github.com/gin-gonic/gin"
	"github.com/samber/lo"
)

// Adaptor handles magic666.top — a proxy that exposes:
//   - Gemini image models via Gemini-native format (Bearer auth)
//     POST {base}/v1beta/models/{model}:generateContent
//   - OpenAI image models (gpt-image-2, gpt-image-2-pro) via OpenAI format (Bearer auth)
//     POST {base}/v1/images/generations
//   - Chat/audio via OpenAI-compatible format
type Adaptor struct{}

func (a *Adaptor) Init(info *relaycommon.RelayInfo) {}

func isGeminiImageModel(model string) bool {
	return strings.HasPrefix(model, "gemini") || strings.HasPrefix(model, "imagen")
}

func (a *Adaptor) GetRequestURL(info *relaycommon.RelayInfo) (string, error) {
	switch info.RelayMode {
	case constant.RelayModeImagesGenerations, constant.RelayModeImagesEdits:
		if isGeminiImageModel(info.UpstreamModelName) {
			return fmt.Sprintf("%s/v1beta/models/%s:generateContent", info.ChannelBaseUrl, info.UpstreamModelName), nil
		}
		return info.ChannelBaseUrl + "/v1/images/generations", nil
	case constant.RelayModeEmbeddings:
		return fmt.Sprintf("%s/v1/embeddings", info.ChannelBaseUrl), nil
	case constant.RelayModeAudioSpeech:
		return fmt.Sprintf("%s/v1/audio/speech", info.ChannelBaseUrl), nil
	case constant.RelayModeAudioTranscription:
		return fmt.Sprintf("%s/v1/audio/transcriptions", info.ChannelBaseUrl), nil
	case constant.RelayModeAudioTranslation:
		return fmt.Sprintf("%s/v1/audio/translations", info.ChannelBaseUrl), nil
	case constant.RelayModeCompletions:
		return fmt.Sprintf("%s/v1/completions", info.ChannelBaseUrl), nil
	case constant.RelayModeResponses:
		return fmt.Sprintf("%s/v1/responses", info.ChannelBaseUrl), nil
	default:
		return fmt.Sprintf("%s/v1/chat/completions", info.ChannelBaseUrl), nil
	}
}

// SetupRequestHeader always uses Bearer auth regardless of model type.
func (a *Adaptor) SetupRequestHeader(c *gin.Context, req *http.Header, info *relaycommon.RelayInfo) error {
	channel.SetupApiRequestHeader(info, c, req)
	req.Set("Authorization", "Bearer "+info.ApiKey)
	return nil
}

func (a *Adaptor) ConvertOpenAIRequest(c *gin.Context, info *relaycommon.RelayInfo, request *dto.GeneralOpenAIRequest) (any, error) {
	if request == nil {
		return nil, errors.New("request is nil")
	}
	return request, nil
}

func (a *Adaptor) ConvertClaudeRequest(c *gin.Context, info *relaycommon.RelayInfo, request *dto.ClaudeRequest) (any, error) {
	adaptor := openai.Adaptor{}
	return adaptor.ConvertClaudeRequest(c, info, request)
}

func (a *Adaptor) ConvertGeminiRequest(c *gin.Context, info *relaycommon.RelayInfo, request *dto.GeminiChatRequest) (any, error) {
	adaptor := openai.Adaptor{}
	return adaptor.ConvertGeminiRequest(c, info, request)
}

// ConvertImageRequest routes to Gemini or OpenAI format based on model name.
func (a *Adaptor) ConvertImageRequest(c *gin.Context, info *relaycommon.RelayInfo, request dto.ImageRequest) (any, error) {
	if isGeminiImageModel(info.UpstreamModelName) {
		return a.convertGeminiImageRequest(c, info, request)
	}
	// magic666 OpenAI image endpoint requires size as pixel dimensions
	// (e.g. "1536x1024"), not an aspect-ratio string like "16:9".
	request = resolveOpenAISizeForMagic666(request)
	oa := openai.Adaptor{}
	return oa.ConvertImageRequest(c, info, request)
}

// resolveOpenAISizeForMagic666 converts aspect-ratio + resolution extra fields
// into a concrete "widthxheight" size string for the magic666 OpenAI endpoint.
func resolveOpenAISizeForMagic666(request dto.ImageRequest) dto.ImageRequest {
	size := strings.TrimSpace(request.Size)
	if size == "" || !strings.Contains(size, ":") {
		return request
	}
	resolution := extractResolutionFromExtra(request)
	if resolved := aspectRatioToOpenAIPixels(size, resolution); resolved != "" {
		request.Size = resolved
	}
	// Remove magic666-incompatible extra fields so they are not forwarded upstream.
	if len(request.Extra) > 0 {
		drop := map[string]struct{}{
			"resolution": {}, "imageSize": {}, "image_size": {}, "metadata": {},
		}
		filtered := make(map[string]json.RawMessage, len(request.Extra))
		for k, v := range request.Extra {
			if _, skip := drop[k]; !skip {
				filtered[k] = v
			}
		}
		request.Extra = filtered
	}
	return request
}

// extractResolutionFromExtra reads the resolution level (1K/2K/4K) from
// the request Extra map, falling back to the Quality field.
func extractResolutionFromExtra(request dto.ImageRequest) string {
	for _, key := range []string{"resolution", "imageSize", "image_size"} {
		if raw, ok := request.Extra[key]; ok && len(raw) > 0 {
			var value string
			if common.Unmarshal(raw, &value) == nil {
				v := strings.TrimSpace(strings.ToUpper(value))
				if v != "" {
					return v
				}
			}
		}
	}
	switch strings.ToLower(strings.TrimSpace(request.Quality)) {
	case "high", "hd":
		return "2K"
	}
	return "1K"
}

// aspectRatioToOpenAIPixels maps (aspect_ratio, resolution) to pixel dimensions
// accepted by magic666's gpt-image-2-pro endpoint.
func aspectRatioToOpenAIPixels(ratio, resolution string) string {
	type key struct{ ar, res string }
	sizeMap := map[key]string{
		{"1:1", "1K"}:  "1024x1024",
		{"1:1", "2K"}:  "2048x2048",
		{"1:1", "4K"}:  "4096x4096",
		{"16:9", "1K"}: "1536x1024",
		{"16:9", "2K"}: "3072x2048",
		{"16:9", "4K"}: "3840x2160",
		{"9:16", "1K"}: "1024x1536",
		{"9:16", "2K"}: "2048x3072",
		{"9:16", "4K"}: "2160x3840",
		{"4:3", "1K"}:  "1280x960",
		{"4:3", "2K"}:  "2048x1536",
		{"4:3", "4K"}:  "4096x3072",
		{"3:4", "1K"}:  "960x1280",
		{"3:4", "2K"}:  "1536x2048",
		{"3:4", "4K"}:  "3072x4096",
		{"3:2", "1K"}:  "1536x1024",
		{"3:2", "2K"}:  "3072x2048",
		{"3:2", "4K"}:  "3840x2560",
		{"2:3", "1K"}:  "1024x1536",
		{"2:3", "2K"}:  "2048x3072",
		{"2:3", "4K"}:  "2560x3840",
	}
	k := key{ar: strings.ToLower(strings.TrimSpace(ratio)), res: strings.ToUpper(strings.TrimSpace(resolution))}
	if size, ok := sizeMap[k]; ok {
		return size
	}
	// Fallback by aspect ratio only.
	switch strings.ToLower(strings.TrimSpace(ratio)) {
	case "16:9", "3:2":
		return "1536x1024"
	case "9:16", "2:3":
		return "1024x1536"
	default:
		return "1024x1024"
	}
}

// convertGeminiImageRequest builds a GeminiChatRequest for image generation.
// Mirrors gemini.Adaptor.ConvertImageRequest but without the IsGeminiModelSupportImagine guard.
func (a *Adaptor) convertGeminiImageRequest(c *gin.Context, info *relaycommon.RelayInfo, request dto.ImageRequest) (any, error) {
	referenceParts, err := imageutil.DownloadReferenceImagesAsGeminiInlineData(imageutil.ExtractReferenceImages(&request))
	if err != nil {
		return nil, err
	}

	geminiRequest := dto.GeminiChatRequest{
		Contents: []dto.GeminiChatContent{
			{
				Role: "user",
				Parts: append(referenceParts, dto.GeminiPart{
					Text: request.Prompt,
				}),
			},
		},
		GenerationConfig: dto.GeminiChatGenerationConfig{
			ResponseModalities: []string{"TEXT", "IMAGE"},
			CandidateCount:     common.GetPointer(int(lo.FromPtrOr(request.N, uint(1)))),
		},
	}

	geminiImageConfig := make(map[string]string)
	size := strings.TrimSpace(request.Size)
	if strings.Contains(size, ":") {
		geminiImageConfig["aspectRatio"] = size
	} else {
		switch size {
		case "256x256", "512x512", "1024x1024":
			geminiImageConfig["aspectRatio"] = "1:1"
		case "1536x1024":
			geminiImageConfig["aspectRatio"] = "3:2"
		case "1024x1536":
			geminiImageConfig["aspectRatio"] = "2:3"
		case "1024x1792":
			geminiImageConfig["aspectRatio"] = "9:16"
		case "1792x1024":
			geminiImageConfig["aspectRatio"] = "16:9"
		}
	}
	if request.Quality != "" {
		switch request.Quality {
		case "hd", "high":
			geminiImageConfig["imageSize"] = "2K"
		case "2K":
			geminiImageConfig["imageSize"] = "2K"
		case "standard", "medium", "low", "auto", "1K":
			geminiImageConfig["imageSize"] = "1K"
		}
	}
	if requestedImageSize := imageutil.NormalizeGeminiImageSize(imageutil.ExtractRequestedImageSize(&request)); requestedImageSize != "" {
		geminiImageConfig["imageSize"] = requestedImageSize
	}
	if len(geminiImageConfig) > 0 {
		imageConfigBytes, err := common.Marshal(geminiImageConfig)
		if err != nil {
			return nil, err
		}
		geminiRequest.GenerationConfig.ImageConfig = imageConfigBytes
	}

	return geminiRequest, nil
}

func (a *Adaptor) ConvertAudioRequest(c *gin.Context, info *relaycommon.RelayInfo, request dto.AudioRequest) (io.Reader, error) {
	adaptor := openai.Adaptor{}
	return adaptor.ConvertAudioRequest(c, info, request)
}

func (a *Adaptor) ConvertRerankRequest(c *gin.Context, relayMode int, request dto.RerankRequest) (any, error) {
	return request, nil
}

func (a *Adaptor) ConvertEmbeddingRequest(c *gin.Context, info *relaycommon.RelayInfo, request dto.EmbeddingRequest) (any, error) {
	return request, nil
}

func (a *Adaptor) ConvertOpenAIResponsesRequest(c *gin.Context, info *relaycommon.RelayInfo, request dto.OpenAIResponsesRequest) (any, error) {
	adaptor := openai.Adaptor{}
	return adaptor.ConvertOpenAIResponsesRequest(c, info, request)
}

func (a *Adaptor) DoRequest(c *gin.Context, info *relaycommon.RelayInfo, requestBody io.Reader) (any, error) {
	return channel.DoApiRequest(a, c, info, requestBody)
}

// DoResponse routes to Gemini image handler or OpenAI handler based on model.
func (a *Adaptor) DoResponse(c *gin.Context, resp *http.Response, info *relaycommon.RelayInfo) (usage any, err *types.NewAPIError) {
	if (info.RelayMode == constant.RelayModeImagesGenerations || info.RelayMode == constant.RelayModeImagesEdits) &&
		isGeminiImageModel(info.UpstreamModelName) {
		return gemini.GeminiImagineImageHandler(c, info, resp)
	}
	oa := openai.Adaptor{}
	return oa.DoResponse(c, resp, info)
}

func (a *Adaptor) GetModelList() []string { return ModelList }

func (a *Adaptor) GetChannelName() string { return ChannelName }
