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
	"github.com/QuantumNous/new-api/relay/channel/claude"
	"github.com/QuantumNous/new-api/relay/channel/imageutil"
	"github.com/QuantumNous/new-api/relay/channel/openai"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	"github.com/QuantumNous/new-api/relay/constant"
	"github.com/QuantumNous/new-api/types"

	"github.com/gin-gonic/gin"
)

// Adaptor adapts the RightCode (right.codes) multi-endpoint API behind one channel:
//   - {root}/codex (or /codex-pro) — OpenAI-compatible chat/completions + responses (gpt-5.x)
//   - {root}/draw     — image generation; `size` is "NxM" pixel dimensions, this
//     adaptor converts incoming 1K/2K/4K + aspect-ratio aliases to pixel dims
//   - {root}/claude   — Anthropic Messages API (claude-*), x-api-key auth
//   - {root}/deepseek — OpenAI-compatible chat/completions (deepseek-v4-*), Bearer auth
//   - {root}/grok     — OpenAI-compatible Responses API (grok-*), Bearer auth
//
// The channel base_url is either the bare root (https://www.right.codes), a
// codex endpoint base (https://www.right.codes/codex-pro[/v1]) to pick the
// codex tier, or a claude tier base (https://rightapi.ai/claude-bug) to pick a
// claude endpoint variant; draw/deepseek always route from the root. Legacy
// configs pointing at "/draw", "/codex", "/claude", "/deepseek" (optionally
// with "/v1") are normalised.
type Adaptor struct{}

func (a *Adaptor) Init(info *relaycommon.RelayInfo) {}

// isClaudeModel reports whether the upstream model routes to the Anthropic-format
// /claude endpoint (claude-sonnet-4-5-*, claude-fable-5, ...).
func isClaudeModel(model string) bool {
	return strings.HasPrefix(strings.ToLower(strings.TrimSpace(model)), "claude")
}

// isDeepseekModel reports whether the upstream model routes to the
// OpenAI-compatible /deepseek endpoint (deepseek-v4-pro, deepseek-v4-flash, ...).
func isDeepseekModel(model string) bool {
	return strings.HasPrefix(strings.ToLower(strings.TrimSpace(model)), "deepseek")
}

// isGrokModel reports whether the upstream model routes to the
// OpenAI-compatible /grok endpoint (grok-4.5, ...).
func isGrokModel(model string) bool {
	return strings.HasPrefix(strings.ToLower(strings.TrimSpace(model)), "grok-")
}

// normalizeBaseURL trims whitespace, a trailing slash and a trailing "/v1"
// (users often paste the full endpoint base from the provider docs).
func normalizeBaseURL(base string) string {
	base = strings.TrimSuffix(strings.TrimSpace(base), "/")
	return strings.TrimSuffix(base, "/v1")
}

// rootBaseURL strips an endpoint suffix from the channel base_url so the
// adaptor can append the per-model endpoint segment itself.
func rootBaseURL(base string) string {
	base = normalizeBaseURL(base)
	for _, suffix := range []string{"/draw", "/deepseek", "/grok", "/codex-pro", "/codex"} {
		if strings.HasSuffix(base, suffix) {
			return strings.TrimSuffix(base, suffix)
		}
	}
	if root, ok := trimClaudeTier(base); ok {
		return root
	}
	return base
}

// trimClaudeTier detects a claude tier as the trailing path segment of the
// base_url ("/claude", "/claude-bug", ...) and returns the base without it.
// Provider hosts expose variant claude endpoints as sibling path prefixes
// (e.g. rightapi.ai/claude-bug), so any dot-free segment starting with
// "claude" counts; the dot guard keeps hostnames like claude.example.com out.
func trimClaudeTier(base string) (string, bool) {
	i := strings.LastIndex(base, "/")
	if i < 0 {
		return base, false
	}
	seg := base[i+1:]
	if strings.HasPrefix(seg, "claude") && !strings.Contains(seg, ".") {
		return base[:i], true
	}
	return base, false
}

// claudeBaseURL resolves the Anthropic-format endpoint base. A base_url that
// already points at a claude tier ("/claude", "/claude-bug", ...) is honoured
// as-is; otherwise the default "/claude" segment is appended to the root.
func claudeBaseURL(base string) string {
	base = normalizeBaseURL(base)
	if _, ok := trimClaudeTier(base); ok {
		return base
	}
	return rootBaseURL(base) + "/claude"
}

// deepseekBaseURL resolves the OpenAI-compatible DeepSeek endpoint base from the
// channel root, regardless of which endpoint segment the base_url points at.
func deepseekBaseURL(base string) string {
	return rootBaseURL(base) + "/deepseek"
}

// grokBaseURL resolves the OpenAI-compatible Grok endpoint base from the
// channel root, regardless of which endpoint segment the base_url points at.
func grokBaseURL(base string) string {
	return rootBaseURL(base) + "/grok"
}

// codexBaseURL resolves the OpenAI-compatible endpoint base. A base_url that
// already points at a codex tier ("/codex" or "/codex-pro") is honoured as-is;
// otherwise the default "/codex" segment is appended to the root.
func codexBaseURL(base string) string {
	base = normalizeBaseURL(base)
	if strings.HasSuffix(base, "/codex") || strings.HasSuffix(base, "/codex-pro") {
		return base
	}
	return rootBaseURL(base) + "/codex"
}

func (a *Adaptor) GetRequestURL(info *relaycommon.RelayInfo) (string, error) {
	root := rootBaseURL(info.ChannelBaseUrl)
	codexBase := codexBaseURL(info.ChannelBaseUrl)
	switch info.RelayMode {
	case constant.RelayModeImagesGenerations, constant.RelayModeImagesEdits:
		return root + "/draw/v1/images/generations", nil
	case constant.RelayModeEmbeddings:
		return fmt.Sprintf("%s/v1/embeddings", codexBase), nil
	case constant.RelayModeAudioSpeech:
		return fmt.Sprintf("%s/v1/audio/speech", codexBase), nil
	case constant.RelayModeAudioTranscription:
		return fmt.Sprintf("%s/v1/audio/transcriptions", codexBase), nil
	case constant.RelayModeAudioTranslation:
		return fmt.Sprintf("%s/v1/audio/translations", codexBase), nil
	case constant.RelayModeCompletions:
		return fmt.Sprintf("%s/v1/completions", codexBase), nil
	case constant.RelayModeResponses, constant.RelayModeResponsesCompact:
		if isClaudeModel(info.UpstreamModelName) {
			return "", errors.New("rightcode: claude models do not support the responses API, use chat completions or /v1/messages")
		}
		if isDeepseekModel(info.UpstreamModelName) {
			return "", errors.New("rightcode: deepseek models do not support the responses API, use chat completions")
		}
		if isGrokModel(info.UpstreamModelName) {
			return relaycommon.GetFullRequestURL(grokBaseURL(info.ChannelBaseUrl), info.RequestURLPath, info.ProtocolID), nil
		}
		return relaycommon.GetFullRequestURL(codexBase, info.RequestURLPath, info.ProtocolID), nil
	default:
		if isClaudeModel(info.UpstreamModelName) {
			return claudeBaseURL(info.ChannelBaseUrl) + "/v1/messages", nil
		}
		if isDeepseekModel(info.UpstreamModelName) {
			return deepseekBaseURL(info.ChannelBaseUrl) + "/v1/chat/completions", nil
		}
		if isGrokModel(info.UpstreamModelName) {
			return grokBaseURL(info.ChannelBaseUrl) + "/v1/chat/completions", nil
		}
		return fmt.Sprintf("%s/v1/chat/completions", codexBase), nil
	}
}

func (a *Adaptor) SetupRequestHeader(c *gin.Context, req *http.Header, info *relaycommon.RelayInfo) error {
	channel.SetupApiRequestHeader(info, c, req)
	if isClaudeModel(info.UpstreamModelName) && !isImageOrAudioMode(info.RelayMode) {
		req.Set("x-api-key", info.ApiKey)
		anthropicVersion := c.Request.Header.Get("anthropic-version")
		if anthropicVersion == "" {
			anthropicVersion = "2023-06-01"
		}
		req.Set("anthropic-version", anthropicVersion)
		claude.CommonClaudeHeadersOperation(c, req, info)
		return nil
	}
	req.Set("Authorization", "Bearer "+info.ApiKey)
	return nil
}

func isImageOrAudioMode(relayMode int) bool {
	switch relayMode {
	case constant.RelayModeImagesGenerations, constant.RelayModeImagesEdits,
		constant.RelayModeAudioSpeech, constant.RelayModeAudioTranscription,
		constant.RelayModeAudioTranslation:
		return true
	}
	return false
}

func (a *Adaptor) ConvertOpenAIRequest(c *gin.Context, info *relaycommon.RelayInfo, request *dto.GeneralOpenAIRequest) (any, error) {
	if request == nil {
		return nil, errors.New("request is nil")
	}
	if isClaudeModel(info.UpstreamModelName) {
		// 不注入 cache_control：实测 right.codes 号池每次请求落不同账号，
		// 跨请求缓存永远 miss，注入只会让全 prompt 按 1.25× 缓存写入价计费（纯亏）。
		// 客户端自带的 cache_control（native /v1/messages 透传）不受影响。
		converted, err := claude.RequestOpenAI2ClaudeMessage(c, *request, info.ChannelOtherSettings.ClaudeImageURLPassThrough)
		if err != nil {
			return nil, err
		}
		if err := claude.EnsureClaudeCodeSystem(converted); err != nil {
			return nil, err
		}
		return converted, nil
	}
	return request, nil
}

func (a *Adaptor) ConvertClaudeRequest(c *gin.Context, info *relaycommon.RelayInfo, request *dto.ClaudeRequest) (any, error) {
	if isClaudeModel(info.UpstreamModelName) {
		if err := claude.EnsureClaudeCodeSystem(request); err != nil {
			return nil, err
		}
		return request, nil
	}
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
	if isClaudeModel(info.UpstreamModelName) {
		return nil, errors.New("rightcode: claude models do not support the responses API, use chat completions or /v1/messages")
	}
	adaptor := openai.Adaptor{}
	return adaptor.ConvertOpenAIResponsesRequest(c, info, request)
}

func (a *Adaptor) DoRequest(c *gin.Context, info *relaycommon.RelayInfo, requestBody io.Reader) (any, error) {
	return channel.DoApiRequest(a, c, info, requestBody)
}

func (a *Adaptor) DoResponse(c *gin.Context, resp *http.Response, info *relaycommon.RelayInfo) (usage any, err *types.NewAPIError) {
	if isClaudeModel(info.UpstreamModelName) && !isImageOrAudioMode(info.RelayMode) {
		info.FinalRequestRelayFormat = types.RelayFormatClaude
		if info.IsStream {
			return claude.ClaudeStreamHandler(c, resp, info)
		}
		return claude.ClaudeHandler(c, resp, info)
	}
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
