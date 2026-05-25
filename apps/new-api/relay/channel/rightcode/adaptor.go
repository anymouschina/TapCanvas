package rightcode

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
	"github.com/QuantumNous/new-api/relay/channel/imageutil"
	"github.com/QuantumNous/new-api/relay/channel/openai"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	"github.com/QuantumNous/new-api/relay/constant"
	"github.com/QuantumNous/new-api/types"

	"github.com/gin-gonic/gin"
)

// Adaptor adapts the RightCode image generation API.
// RightCode is OpenAI-compatible for chat/audio; its /v1/images/generations
// endpoint accepts a synchronous response with `size` as "NxM" pixel dimensions.
// This adaptor converts incoming 1K/2K/4K + aspect-ratio aliases to pixel dims.
type Adaptor struct{}

func (a *Adaptor) Init(info *relaycommon.RelayInfo) {}

func (a *Adaptor) GetRequestURL(info *relaycommon.RelayInfo) (string, error) {
	switch info.RelayMode {
	case constant.RelayModeImagesGenerations, constant.RelayModeImagesEdits:
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
	default:
		return fmt.Sprintf("%s/v1/chat/completions", info.ChannelBaseUrl), nil
	}
}

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

// rightcodeImagePayload is the JSON body sent to RightCode's images endpoint.
type rightcodeImagePayload struct {
	Model          string   `json:"model"`
	Prompt         string   `json:"prompt"`
	Image          []string `json:"image,omitempty"`
	Size           string   `json:"size,omitempty"`
	ResponseFormat string   `json:"response_format,omitempty"`
}

// ConvertImageRequest converts the OpenAI-style ImageRequest to RightCode's
// expected payload, resolving the size alias (1K/2K/4K + aspect ratio → NxM).
func (a *Adaptor) ConvertImageRequest(c *gin.Context, info *relaycommon.RelayInfo, request dto.ImageRequest) (any, error) {
	refs := imageutil.ExtractReferenceImages(&request)

	// Resolve aspect ratio: prefer request.Size when it looks like a ratio (contains ":"),
	// otherwise fall back to metadata.aspectRatio.
	aspectRatio := ""
	if strings.Contains(request.Size, ":") {
		aspectRatio = request.Size
	}
	if aspectRatio == "" {
		aspectRatio = extractStringExtra(&request, "aspectRatio", "aspect_ratio")
		if aspectRatio == "" {
			if raw, ok := request.Extra["metadata"]; ok && len(raw) > 0 {
				var meta map[string]json.RawMessage
				if err := common.Unmarshal(raw, &meta); err == nil {
					for _, k := range []string{"aspectRatio", "aspect_ratio"} {
						if v, ok := meta[k]; ok {
							var s string
							if err := common.Unmarshal(v, &s); err == nil && s != "" {
								aspectRatio = s
								break
							}
						}
					}
				}
			}
		}
	}

	// Resolve resolution level: "1K" / "2K" / "4K".
	resolution := extractStringExtra(&request, "resolution", "imageSize", "image_size")
	if resolution == "" {
		if raw, ok := request.Extra["metadata"]; ok && len(raw) > 0 {
			var meta map[string]json.RawMessage
			if err := common.Unmarshal(raw, &meta); err == nil {
				for _, k := range []string{"imageSize", "image_size", "resolution"} {
					if v, ok := meta[k]; ok {
						var s string
						if err := common.Unmarshal(v, &s); err == nil && s != "" {
							resolution = s
							break
						}
					}
				}
			}
		}
	}

	pixelSize := resolvePixelSize(aspectRatio, resolution)
	// Fall back to request.Size if it already looks like NxM.
	if pixelSize == "" && strings.Contains(request.Size, "x") {
		pixelSize = request.Size
	}

	responseFormat := request.ResponseFormat
	if responseFormat == "" {
		responseFormat = "url"
	}

	payload := &rightcodeImagePayload{
		Model:          info.UpstreamModelName,
		Prompt:         request.Prompt,
		Image:          refs,
		Size:           pixelSize,
		ResponseFormat: responseFormat,
	}
	return payload, nil
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
	return nil, errors.New("not implemented")
}

func (a *Adaptor) DoRequest(c *gin.Context, info *relaycommon.RelayInfo, requestBody io.Reader) (any, error) {
	return channel.DoApiRequest(a, c, info, requestBody)
}

func (a *Adaptor) DoResponse(c *gin.Context, resp *http.Response, info *relaycommon.RelayInfo) (usage any, err *types.NewAPIError) {
	adaptor := openai.Adaptor{}
	return adaptor.DoResponse(c, resp, info)
}

func (a *Adaptor) GetModelList() []string { return ModelList }

func (a *Adaptor) GetChannelName() string { return ChannelName }

// extractStringExtra reads the first non-empty string from the given Extra keys.
func extractStringExtra(req *dto.ImageRequest, keys ...string) string {
	for _, k := range keys {
		raw, ok := req.Extra[k]
		if !ok || len(raw) == 0 {
			continue
		}
		var s string
		if err := common.Unmarshal(raw, &s); err == nil {
			if s = strings.TrimSpace(s); s != "" {
				return s
			}
		}
	}
	return ""
}

// resolvePixelSize maps (aspectRatio, resolution) → "WxH".
// Falls back to 1024x1024 when the combination is not recognised.
func resolvePixelSize(aspectRatio, resolution string) string {
	// Normalise: "16:9" + "2K" → ("16:9", "2k")
	ar := strings.TrimSpace(aspectRatio)
	res := strings.ToLower(strings.TrimSpace(resolution))

	// Pixel dimensions sourced from rightcodes gpt-image-2 API spec (apifox).
	// Only combinations explicitly listed in the spec are included; unsupported
	// combinations fall back to the nearest 1K size for the given ratio.
	table := map[string]map[string]string{
		"16:9": {"1k": "1920x1080", "2k": "2048x1152", "4k": "3840x2160"},
		"9:16": {"1k": "1080x1920", "2k": "1152x2048", "4k": "2160x3840"},
		"1:1":  {"1k": "1024x1024", "2k": "2048x2048"},
		"3:2":  {"1k": "1536x1024"},
		"2:3":  {"1k": "1024x1536"},
		"21:9": {"1k": "1280x549", "2k": "2560x1097", "4k": "3840x1645"},
		"9:21": {"1k": "549x1280", "2k": "1097x2560", "4k": "1645x3840"},
	}

	if ratioMap, ok := table[ar]; ok {
		if px, ok := ratioMap[res]; ok {
			return px
		}
		// Resolution unknown but ratio known — default to 1K.
		if px, ok := ratioMap["1k"]; ok {
			return px
		}
	}

	// Resolution only (no usable aspect ratio) — default to 1:1.
	switch res {
	case "1k":
		return "1024x1024"
	case "2k":
		return "2048x2048"
	case "4k":
		return "3840x2160"
	}

	return "1024x1024"
}
