package lingjing

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/dto"
	"github.com/QuantumNous/new-api/logger"
	"github.com/QuantumNous/new-api/relay/channel"
	"github.com/QuantumNous/new-api/relay/channel/imageutil"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	"github.com/QuantumNous/new-api/relay/constant"
	"github.com/QuantumNous/new-api/service"
	"github.com/QuantumNous/new-api/types"

	"github.com/gin-gonic/gin"
)

// Adaptor wraps 灵镜AI's asynchronous draw API (submit → poll) into a synchronous
// OpenAI-compatible /v1/images/generations response, so existing image clients
// (hono-api, OpenAI SDK) keep working without knowing it is async upstream.
//
// This channel is image-only; chat/audio/embedding modes are not supported.
type Adaptor struct{}

func (a *Adaptor) Init(info *relaycommon.RelayInfo) {}

func (a *Adaptor) GetRequestURL(info *relaycommon.RelayInfo) (string, error) {
	switch info.RelayMode {
	case constant.RelayModeImagesGenerations, constant.RelayModeImagesEdits:
		return info.ChannelBaseUrl + submitPath, nil
	default:
		return "", fmt.Errorf("lingjing: relay mode %d not supported (image-only channel)", info.RelayMode)
	}
}

// SetupRequestHeader installs 灵镜's dual-key auth. The channel key is stored as
// "accessKey|secretKey" (Tencent-style). If no "|" is present the whole key is
// used as the access key and the secret key is left empty.
func (a *Adaptor) SetupRequestHeader(c *gin.Context, req *http.Header, info *relaycommon.RelayInfo) error {
	channel.SetupApiRequestHeader(info, c, req)
	accessKey, secretKey := splitKey(info.ApiKey)
	req.Set("X-Access-Key", accessKey)
	req.Set("X-Secret-Key", secretKey)
	req.Set("Content-Type", "application/json")
	return nil
}

func splitKey(key string) (accessKey, secretKey string) {
	parts := strings.SplitN(strings.TrimSpace(key), "|", 2)
	accessKey = strings.TrimSpace(parts[0])
	if len(parts) == 2 {
		secretKey = strings.TrimSpace(parts[1])
	}
	return accessKey, secretKey
}

// --- submit payload (matches the user-provided curls) ---

type submitSource struct {
	Kind  string `json:"kind"`
	Value string `json:"value"`
}

type submitResource struct {
	Type   string       `json:"type"`
	Usage  string       `json:"usage"`
	Source submitSource `json:"source"`
}

type submitInput struct {
	Ratio            string           `json:"ratio,omitempty"`
	Prompt           string           `json:"prompt"`
	Quality          string           `json:"quality,omitempty"`
	GenerationEffort string           `json:"generation_effort,omitempty"`
	Resources        []submitResource `json:"resources,omitempty"`
}

type submitTaskParams struct {
	Input submitInput `json:"input"`
}

type submitPayload struct {
	ModelCode  string           `json:"modelCode"`
	TaskParams submitTaskParams `json:"taskParams"`
}

func (a *Adaptor) ConvertImageRequest(c *gin.Context, info *relaycommon.RelayInfo, request dto.ImageRequest) (any, error) {
	// --- ratio (灵镜 uses an aspect-ratio string like "1:1"/"4:5"/"16:9") ---
	ratio := strings.TrimSpace(request.Size)
	if !strings.Contains(ratio, ":") {
		// A pixel size or empty value isn't a 灵镜 ratio; try the aspect_ratio extra.
		ratio = ""
		if raw, ok := request.Extra["aspect_ratio"]; ok && len(raw) > 0 {
			var ar string
			if common.Unmarshal(raw, &ar) == nil {
				ratio = strings.TrimSpace(ar)
			}
		}
		if ratio == "" {
			ratio = "1:1"
		}
	}

	// --- quality / resolution (1K / 2K / 4K) ---
	quality := strings.ToUpper(strings.TrimSpace(extractResolution(&request)))
	if quality == "" {
		quality = "1K"
	}

	// --- optional generation_effort pass-through ---
	effort := ""
	if raw, ok := request.Extra["generation_effort"]; ok && len(raw) > 0 {
		var e string
		if common.Unmarshal(raw, &e) == nil {
			effort = strings.TrimSpace(e)
		}
	}

	// --- reference images → resources[] ---
	var resources []submitResource
	for _, url := range imageutil.ExtractReferenceImages(&request) {
		url = strings.TrimSpace(url)
		if url == "" {
			continue
		}
		resources = append(resources, submitResource{
			Type:   "image",
			Usage:  "reference",
			Source: submitSource{Kind: "url", Value: url},
		})
	}

	payload := submitPayload{
		ModelCode: resolveUpstreamModelCode(info.UpstreamModelName),
		TaskParams: submitTaskParams{
			Input: submitInput{
				Ratio:            ratio,
				Prompt:           request.Prompt,
				Quality:          quality,
				GenerationEffort: effort,
				Resources:        resources,
			},
		},
	}
	return payload, nil
}

// extractResolution reads the resolution level (1K/2K/4K) from common request
// fields, falling back to the OpenAI-style quality hint.
func extractResolution(request *dto.ImageRequest) string {
	for _, key := range []string{"resolution", "quality", "image_size", "imageSize"} {
		if raw, ok := request.Extra[key]; ok && len(raw) > 0 {
			var v string
			if common.Unmarshal(raw, &v) == nil {
				if v = strings.TrimSpace(v); v != "" {
					return v
				}
			}
		}
	}
	if size := imageutil.ExtractRequestedImageSize(request); size != "" {
		return size
	}
	switch strings.ToLower(strings.TrimSpace(request.Quality)) {
	case "high", "hd":
		return "2K"
	}
	return ""
}

// --- async submit → poll → synthesize sync response ---

func (a *Adaptor) DoRequest(c *gin.Context, info *relaycommon.RelayInfo, requestBody io.Reader) (any, error) {
	switch info.RelayMode {
	case constant.RelayModeImagesGenerations, constant.RelayModeImagesEdits:
		return a.doAsyncImage(c, info, requestBody)
	default:
		return nil, fmt.Errorf("lingjing: relay mode %d not supported", info.RelayMode)
	}
}

func (a *Adaptor) doAsyncImage(c *gin.Context, info *relaycommon.RelayInfo, requestBody io.Reader) (any, error) {
	submitURL, err := a.GetRequestURL(info)
	if err != nil {
		return nil, err
	}
	httpReq, err := http.NewRequestWithContext(c.Request.Context(), http.MethodPost, submitURL, requestBody)
	if err != nil {
		return nil, fmt.Errorf("lingjing: new submit request failed: %w", err)
	}
	if err := a.SetupRequestHeader(c, &httpReq.Header, info); err != nil {
		return nil, err
	}

	resp, err := channel.DoRequest(c, httpReq, info)
	if err != nil {
		return nil, fmt.Errorf("lingjing: submit failed: %w", err)
	}
	if resp.StatusCode != http.StatusOK {
		return resp, nil
	}
	defer resp.Body.Close()
	submitBody, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("lingjing: read submit body failed: %w", err)
	}

	taskID, err := extractTaskID(submitBody)
	if err != nil {
		return synthesizeJSONResponse(http.StatusBadGateway, submitBody), nil
	}

	detailBody, err := a.pollUntilTerminal(c.Request.Context(), info, taskID)
	if err != nil {
		return nil, err
	}
	return synthesizeJSONResponse(http.StatusOK, detailBody), nil
}

func (a *Adaptor) pollUntilTerminal(ctx context.Context, info *relaycommon.RelayInfo, taskID string) ([]byte, error) {
	client, err := service.GetHttpClientWithProxy(info.ChannelSetting.Proxy)
	if err != nil {
		return nil, fmt.Errorf("lingjing: build poll client failed: %w", err)
	}
	accessKey, secretKey := splitKey(info.ApiKey)
	queryURL := info.ChannelBaseUrl + queryPath

	pollTimeout := 15 * time.Minute
	if common.RelayTimeout > 0 {
		pollTimeout = time.Duration(common.RelayTimeout) * time.Second
	}
	deadline := time.Now().Add(pollTimeout)

	interval := 1500 * time.Millisecond
	const maxInterval = 5 * time.Second

	for {
		select {
		case <-ctx.Done():
			return nil, ctx.Err()
		case <-time.After(interval):
		}
		if time.Now().After(deadline) {
			return nil, fmt.Errorf("lingjing: poll timeout after %s, taskID=%s", pollTimeout, taskID)
		}

		// 实测：query 端点是 GET + ?taskId=（POST 会返回 9003「不支持 POST 方法」，
		// 但 HTTP 仍是 200，错误只在 body code 里，因此绝不能用 POST，否则永远 poll 到超时）。
		req, err := http.NewRequestWithContext(ctx, http.MethodGet, queryURL+"?taskId="+url.QueryEscape(taskID), nil)
		if err != nil {
			return nil, err
		}
		req.Header.Set("Accept", "application/json")
		req.Header.Set("X-Access-Key", accessKey)
		req.Header.Set("X-Secret-Key", secretKey)

		resp, err := client.Do(req)
		if err != nil {
			return nil, fmt.Errorf("lingjing: poll failed: %w", err)
		}
		body, readErr := io.ReadAll(resp.Body)
		resp.Body.Close()
		if readErr != nil {
			return nil, fmt.Errorf("lingjing: read poll body failed: %w", readErr)
		}
		if resp.StatusCode != http.StatusOK {
			return nil, fmt.Errorf("lingjing: poll non-200: status=%d body=%s", resp.StatusCode, string(body))
		}

		status, urls := parseTaskResult(body)
		if status == taskStatusFailed {
			return body, nil
		}
		if status == taskStatusSuccess || len(urls) > 0 {
			return body, nil
		}

		if interval < maxInterval {
			interval += 500 * time.Millisecond
			if interval > maxInterval {
				interval = maxInterval
			}
		}
	}
}

func (a *Adaptor) DoResponse(c *gin.Context, resp *http.Response, info *relaycommon.RelayInfo) (usage any, err *types.NewAPIError) {
	switch info.RelayMode {
	case constant.RelayModeImagesGenerations, constant.RelayModeImagesEdits:
		return a.finishAsyncImage(c, resp, info)
	default:
		return nil, types.NewError(fmt.Errorf("lingjing: relay mode %d not supported", info.RelayMode), types.ErrorCodeBadResponse)
	}
}

func (a *Adaptor) finishAsyncImage(c *gin.Context, resp *http.Response, info *relaycommon.RelayInfo) (any, *types.NewAPIError) {
	defer resp.Body.Close()
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, types.NewError(fmt.Errorf("read upstream body failed: %w", err), types.ErrorCodeReadResponseBodyFailed)
	}

	status, urls := parseTaskResult(body)
	if status == taskStatusFailed {
		msg := extractFailureReason(body)
		if msg == "" {
			msg = "lingjing task failed"
		}
		return nil, types.NewErrorWithStatusCode(errors.New(msg), types.ErrorCodeBadResponse, http.StatusBadGateway)
	}
	if len(urls) == 0 {
		return nil, types.NewErrorWithStatusCode(
			fmt.Errorf("lingjing task returned no result urls, body=%s", string(body)),
			types.ErrorCodeBadResponse, http.StatusBadGateway)
	}

	payload := dto.ImageResponse{Created: time.Now().Unix()}
	for _, u := range urls {
		payload.Data = append(payload.Data, dto.ImageData{Url: u})
	}
	data, mErr := common.Marshal(payload)
	if mErr != nil {
		return nil, types.NewError(fmt.Errorf("marshal image response failed: %w", mErr), types.ErrorCodeBadResponseBody)
	}

	c.Writer.Header().Set("Content-Type", "application/json")
	c.Writer.WriteHeader(http.StatusOK)
	if _, werr := c.Writer.Write(data); werr != nil {
		logger.LogError(c, fmt.Sprintf("lingjing: write response failed: %v", werr))
	}
	return &dto.Usage{PromptTokens: 1, TotalTokens: 1}, nil
}

func (a *Adaptor) GetModelList() []string { return ModelList }

func (a *Adaptor) GetChannelName() string { return ChannelName }

// --- unsupported (image-only channel) ---

func (a *Adaptor) ConvertOpenAIRequest(c *gin.Context, info *relaycommon.RelayInfo, request *dto.GeneralOpenAIRequest) (any, error) {
	return nil, errors.New("lingjing: chat/completions not supported (image-only channel)")
}

func (a *Adaptor) ConvertClaudeRequest(c *gin.Context, info *relaycommon.RelayInfo, request *dto.ClaudeRequest) (any, error) {
	return nil, errors.New("lingjing: claude not supported (image-only channel)")
}

func (a *Adaptor) ConvertGeminiRequest(c *gin.Context, info *relaycommon.RelayInfo, request *dto.GeminiChatRequest) (any, error) {
	return nil, errors.New("lingjing: gemini not supported (image-only channel)")
}

func (a *Adaptor) ConvertAudioRequest(c *gin.Context, info *relaycommon.RelayInfo, request dto.AudioRequest) (io.Reader, error) {
	return nil, errors.New("lingjing: audio not supported (image-only channel)")
}

func (a *Adaptor) ConvertRerankRequest(c *gin.Context, relayMode int, request dto.RerankRequest) (any, error) {
	return nil, errors.New("lingjing: rerank not supported (image-only channel)")
}

func (a *Adaptor) ConvertEmbeddingRequest(c *gin.Context, info *relaycommon.RelayInfo, request dto.EmbeddingRequest) (any, error) {
	return nil, errors.New("lingjing: embedding not supported (image-only channel)")
}

func (a *Adaptor) ConvertOpenAIResponsesRequest(c *gin.Context, info *relaycommon.RelayInfo, request dto.OpenAIResponsesRequest) (any, error) {
	return nil, errors.New("lingjing: responses not supported (image-only channel)")
}

func synthesizeJSONResponse(status int, body []byte) *http.Response {
	header := http.Header{}
	header.Set("Content-Type", "application/json")
	return &http.Response{
		StatusCode:    status,
		Status:        fmt.Sprintf("%d %s", status, http.StatusText(status)),
		Header:        header,
		Body:          io.NopCloser(bytes.NewReader(body)),
		ContentLength: int64(len(body)),
	}
}
