package runninghub

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"
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

// Adaptor wraps RunningHub's asynchronous Standard Model API (submit → poll) into
// a synchronous OpenAI-compatible /v1/images/generations response, so existing
// image clients (hono-api, OpenAI SDK) keep working without knowing it is async
// upstream.
//
// This channel is image-only; chat/audio/embedding modes are not supported.
//
// The submit URL (which RunningHub slug + which op endpoint) depends on the
// requested model AND on whether reference images were supplied, so it is
// resolved in ConvertImageRequest and stashed on submitURL. A fresh Adaptor is
// instantiated per request (see relay.GetAdaptor), so storing per-request state
// here is safe.
type Adaptor struct {
	submitURL string
}

func (a *Adaptor) Init(info *relaycommon.RelayInfo) {}

func (a *Adaptor) GetRequestURL(info *relaycommon.RelayInfo) (string, error) {
	switch info.RelayMode {
	case constant.RelayModeImagesGenerations, constant.RelayModeImagesEdits:
		if a.submitURL != "" {
			return a.submitURL, nil
		}
		// Fallback (ConvertImageRequest should have set submitURL): build a
		// best-effort text-to-image URL from the model alone.
		endpoint, ok := resolveEndpoint(info.UpstreamModelName)
		if !ok {
			return "", fmt.Errorf("runninghub: unknown model %q", info.UpstreamModelName)
		}
		op := endpoint.t2iOp
		if op == "" {
			op = endpoint.editOp
		}
		if op == "" {
			return "", fmt.Errorf("runninghub: model %q has no image endpoint", info.UpstreamModelName)
		}
		return info.ChannelBaseUrl + submitPathPrefix + endpoint.slug + "/" + op, nil
	default:
		return "", fmt.Errorf("runninghub: relay mode %d not supported (image-only channel)", info.RelayMode)
	}
}

// SetupRequestHeader installs RunningHub's Bearer auth.
func (a *Adaptor) SetupRequestHeader(c *gin.Context, req *http.Header, info *relaycommon.RelayInfo) error {
	channel.SetupApiRequestHeader(info, c, req)
	req.Set("Authorization", "Bearer "+strings.TrimSpace(info.ApiKey))
	req.Set("Content-Type", "application/json")
	return nil
}

// --- submit payload (matches the user-provided curls) ---

type submitPayload struct {
	Prompt      string   `json:"prompt"`
	ImageUrls   []string `json:"imageUrls,omitempty"`
	AspectRatio string   `json:"aspectRatio,omitempty"`
	Resolution  string   `json:"resolution,omitempty"`
	Quality     string   `json:"quality,omitempty"`
}

func (a *Adaptor) ConvertImageRequest(c *gin.Context, info *relaycommon.RelayInfo, request dto.ImageRequest) (any, error) {
	endpoint, ok := resolveEndpoint(info.UpstreamModelName)
	if !ok {
		return nil, fmt.Errorf("runninghub: unknown model %q (expected gpt-image-2 / gemini-3.1-flash-image-preview / gemini-3-pro-image-preview)", info.UpstreamModelName)
	}

	// --- aspect ratio (RunningHub uses a ratio string like "1:1"/"9:16"/"16:9") ---
	ratio := strings.TrimSpace(request.Size)
	if !strings.Contains(ratio, ":") {
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

	// --- resolution (1k / 2k / 4k, lowercase per upstream curls) ---
	resolution := normalizeResolution(extractResolution(&request))

	// --- optional quality (low / medium / high) ---
	quality := normalizeQuality(&request)

	// --- reference images → imageUrls[] (already trimmed + de-emptied) ---
	imageUrls := imageutil.ExtractReferenceImages(&request)

	// --- choose op endpoint: edit when images present (or explicit edit mode) ---
	op := endpoint.t2iOp
	wantEdit := len(imageUrls) > 0 || info.RelayMode == constant.RelayModeImagesEdits
	if wantEdit && endpoint.editOp != "" {
		op = endpoint.editOp
	}
	if op == "" { // requested mode unsupported by this model → fall back to whatever exists
		if endpoint.editOp != "" {
			op = endpoint.editOp
		} else {
			op = endpoint.t2iOp
		}
	}
	if op == "" {
		return nil, fmt.Errorf("runninghub: model %q has no usable image endpoint", info.UpstreamModelName)
	}
	a.submitURL = info.ChannelBaseUrl + submitPathPrefix + endpoint.slug + "/" + op

	return submitPayload{
		Prompt:      request.Prompt,
		ImageUrls:   imageUrls,
		AspectRatio: ratio,
		Resolution:  resolution,
		Quality:     quality,
	}, nil
}

// extractResolution reads the requested resolution from common request fields.
func extractResolution(request *dto.ImageRequest) string {
	for _, key := range []string{"resolution", "image_size", "imageSize"} {
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
	return ""
}

// normalizeResolution maps assorted size hints to RunningHub's 1k/2k/4k levels.
func normalizeResolution(raw string) string {
	v := strings.ToLower(strings.TrimSpace(raw))
	switch v {
	case "", "1k", "1024", "1080p", "1080":
		return "1k"
	case "2k", "2048", "1440p":
		return "2k"
	case "4k", "4096", "2160p":
		return "4k"
	}
	// "WxH" pixel form: classify by the larger dimension.
	if i := strings.IndexAny(v, "x*"); i > 0 {
		head := v[:i]
		if head >= "2048" { // crude lexical bump for 2048/4096 etc.
			return "2k"
		}
		return "1k"
	}
	return "1k"
}

// normalizeQuality passes through low/medium/high quality hints; omits otherwise.
func normalizeQuality(request *dto.ImageRequest) string {
	candidates := []string{strings.ToLower(strings.TrimSpace(request.Quality))}
	if raw, ok := request.Extra["quality"]; ok && len(raw) > 0 {
		var v string
		if common.Unmarshal(raw, &v) == nil {
			candidates = append(candidates, strings.ToLower(strings.TrimSpace(v)))
		}
	}
	for _, q := range candidates {
		switch q {
		case "low", "medium", "high":
			return q
		case "hd":
			return "high"
		}
	}
	return ""
}

// --- async submit → poll → synthesize sync response ---

func (a *Adaptor) DoRequest(c *gin.Context, info *relaycommon.RelayInfo, requestBody io.Reader) (any, error) {
	switch info.RelayMode {
	case constant.RelayModeImagesGenerations, constant.RelayModeImagesEdits:
		return a.doAsyncImage(c, info, requestBody)
	default:
		return nil, fmt.Errorf("runninghub: relay mode %d not supported", info.RelayMode)
	}
}

func (a *Adaptor) doAsyncImage(c *gin.Context, info *relaycommon.RelayInfo, requestBody io.Reader) (any, error) {
	submitURL, err := a.GetRequestURL(info)
	if err != nil {
		return nil, err
	}
	httpReq, err := http.NewRequestWithContext(c.Request.Context(), http.MethodPost, submitURL, requestBody)
	if err != nil {
		return nil, fmt.Errorf("runninghub: new submit request failed: %w", err)
	}
	if err := a.SetupRequestHeader(c, &httpReq.Header, info); err != nil {
		return nil, err
	}

	resp, err := channel.DoRequest(c, httpReq, info)
	if err != nil {
		return nil, fmt.Errorf("runninghub: submit failed: %w", err)
	}
	if resp.StatusCode != http.StatusOK {
		return resp, nil
	}
	defer resp.Body.Close()
	submitBody, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("runninghub: read submit body failed: %w", err)
	}

	// Some endpoints may return a terminal result inline (no polling needed).
	if status, urls := parseTaskResult(submitBody); status == taskStatusFailed || (status == taskStatusSuccess && len(urls) > 0) {
		return synthesizeJSONResponse(http.StatusOK, submitBody), nil
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
		return nil, fmt.Errorf("runninghub: build poll client failed: %w", err)
	}
	apiKey := strings.TrimSpace(info.ApiKey)
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
			return nil, fmt.Errorf("runninghub: poll timeout after %s, taskID=%s", pollTimeout, taskID)
		}

		reqBody, _ := common.Marshal(map[string]any{"taskId": taskID})
		req, err := http.NewRequestWithContext(ctx, http.MethodPost, queryURL, bytes.NewReader(reqBody))
		if err != nil {
			return nil, err
		}
		req.Header.Set("Accept", "application/json")
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("Authorization", "Bearer "+apiKey)

		resp, err := client.Do(req)
		if err != nil {
			return nil, fmt.Errorf("runninghub: poll failed: %w", err)
		}
		body, readErr := io.ReadAll(resp.Body)
		resp.Body.Close()
		if readErr != nil {
			return nil, fmt.Errorf("runninghub: read poll body failed: %w", readErr)
		}
		if resp.StatusCode != http.StatusOK {
			return nil, fmt.Errorf("runninghub: poll non-200: status=%d body=%s", resp.StatusCode, string(body))
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
		return nil, types.NewError(fmt.Errorf("runninghub: relay mode %d not supported", info.RelayMode), types.ErrorCodeBadResponse)
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
			msg = "runninghub task failed"
		}
		return nil, types.NewErrorWithStatusCode(errors.New(msg), types.ErrorCodeBadResponse, http.StatusBadGateway)
	}
	if len(urls) == 0 {
		return nil, types.NewErrorWithStatusCode(
			fmt.Errorf("runninghub task returned no result urls, body=%s", string(body)),
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
		logger.LogError(c, fmt.Sprintf("runninghub: write response failed: %v", werr))
	}
	return &dto.Usage{PromptTokens: 1, TotalTokens: 1}, nil
}

func (a *Adaptor) GetModelList() []string { return ModelList }

func (a *Adaptor) GetChannelName() string { return ChannelName }

// --- unsupported (image-only channel) ---

func (a *Adaptor) ConvertOpenAIRequest(c *gin.Context, info *relaycommon.RelayInfo, request *dto.GeneralOpenAIRequest) (any, error) {
	return nil, errors.New("runninghub: chat/completions not supported (image-only channel)")
}

func (a *Adaptor) ConvertClaudeRequest(c *gin.Context, info *relaycommon.RelayInfo, request *dto.ClaudeRequest) (any, error) {
	return nil, errors.New("runninghub: claude not supported (image-only channel)")
}

func (a *Adaptor) ConvertGeminiRequest(c *gin.Context, info *relaycommon.RelayInfo, request *dto.GeminiChatRequest) (any, error) {
	return nil, errors.New("runninghub: gemini chat not supported (image-only channel)")
}

func (a *Adaptor) ConvertAudioRequest(c *gin.Context, info *relaycommon.RelayInfo, request dto.AudioRequest) (io.Reader, error) {
	return nil, errors.New("runninghub: audio not supported (image-only channel)")
}

func (a *Adaptor) ConvertRerankRequest(c *gin.Context, relayMode int, request dto.RerankRequest) (any, error) {
	return nil, errors.New("runninghub: rerank not supported (image-only channel)")
}

func (a *Adaptor) ConvertEmbeddingRequest(c *gin.Context, info *relaycommon.RelayInfo, request dto.EmbeddingRequest) (any, error) {
	return nil, errors.New("runninghub: embedding not supported (image-only channel)")
}

func (a *Adaptor) ConvertOpenAIResponsesRequest(c *gin.Context, info *relaycommon.RelayInfo, request dto.OpenAIResponsesRequest) (any, error) {
	return nil, errors.New("runninghub: responses not supported (image-only channel)")
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
