package evolink

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
	taskapimart "github.com/QuantumNous/new-api/relay/channel/task/apimart"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	"github.com/QuantumNous/new-api/relay/constant"
	"github.com/QuantumNous/new-api/service"
	"github.com/QuantumNous/new-api/types"

	"github.com/gin-gonic/gin"
)

// Adaptor wraps Evolink's asynchronous image API (submit → poll) into a
// synchronous OpenAI-compatible /v1/images/generations response, so existing
// image clients (hono-api, OpenAI SDK) keep working without knowing it is async
// upstream. Async video is served by relay/channel/task/evolink (TaskAdaptor).
//
// This channel is image-only on the sync path; chat/audio/embedding modes are
// not supported.
type Adaptor struct{}

func (a *Adaptor) Init(info *relaycommon.RelayInfo) {}

func (a *Adaptor) GetRequestURL(info *relaycommon.RelayInfo) (string, error) {
	switch info.RelayMode {
	case constant.RelayModeImagesGenerations, constant.RelayModeImagesEdits:
		// Evolink images are async. We emit the submit URL here; DoRequest drives
		// the poll loop internally and synthesizes a sync response.
		return info.ChannelBaseUrl + submitPathImages, nil
	default:
		return "", fmt.Errorf("evolink: relay mode %d not supported (image-only channel)", info.RelayMode)
	}
}

func (a *Adaptor) SetupRequestHeader(c *gin.Context, req *http.Header, info *relaycommon.RelayInfo) error {
	channel.SetupApiRequestHeader(info, c, req)
	req.Set("Authorization", "Bearer "+info.ApiKey)
	req.Set("Content-Type", "application/json")
	return nil
}

// imageSubmitPayload is the Evolink POST /v1/images/generations body. Field
// usage differs per model family (see ConvertImageRequest):
//   - gpt-image-2: resolution=1K/2K/4K, quality=low/medium/high (render effort)
//   - gemini-*   : quality=0.5K/1K/2K/4K (the tier lives in `quality`)
type imageSubmitPayload struct {
	Model       string         `json:"model"`
	Prompt      string         `json:"prompt"`
	Size        string         `json:"size,omitempty"`
	Quality     string         `json:"quality,omitempty"`
	Resolution  string         `json:"resolution,omitempty"`
	ImageUrls   []string       `json:"image_urls,omitempty"`
	N           int            `json:"n,omitempty"`
	ModelParams map[string]any `json:"model_params,omitempty"`
}

func (a *Adaptor) ConvertImageRequest(c *gin.Context, info *relaycommon.RelayInfo, request dto.ImageRequest) (any, error) {
	model := info.UpstreamModelName
	if model == "" {
		model = info.OriginModelName
	}

	// --- size (aspect ratio) ---
	size := strings.TrimSpace(request.Size)
	if size == "" {
		size = stringExtra(&request, "aspect_ratio")
	}

	// --- resolution tier (1K/2K/4K) ---
	tier := extractResolutionTier(&request)

	payload := imageSubmitPayload{
		Model:     model,
		Prompt:    request.Prompt,
		Size:      size,
		ImageUrls: imageutil.ExtractReferenceImages(&request),
	}

	switch {
	case isGptImage2(model):
		payload.Resolution = tier
		// gpt-image-2 `quality` is a render-effort knob (low/medium/high), distinct
		// from the resolution tier. Only forward it when the caller asked for one.
		switch strings.ToLower(strings.TrimSpace(request.Quality)) {
		case "low", "medium", "high":
			payload.Quality = strings.ToLower(strings.TrimSpace(request.Quality))
		}
	case isGeminiImage(model):
		// nanobanana models carry the resolution tier in `quality`.
		payload.Quality = tier
	default:
		// Unknown model: pass tier through `resolution` (most permissive).
		payload.Resolution = tier
	}

	// --- model_params pass-through (web_search / image_search / thinking_level) ---
	mp := map[string]any{}
	for _, key := range []string{"web_search", "image_search", "thinking_level"} {
		if raw, ok := request.Extra[key]; ok && len(raw) > 0 {
			var v any
			if common.Unmarshal(raw, &v) == nil && v != nil {
				mp[key] = v
			}
		}
	}
	// Allow an explicit nested model_params object too (merged, lower priority).
	if raw, ok := request.Extra["model_params"]; ok && len(raw) > 0 {
		var explicit map[string]any
		if common.Unmarshal(raw, &explicit) == nil {
			for k, v := range explicit {
				if _, exists := mp[k]; !exists {
					mp[k] = v
				}
			}
		}
	}
	if len(mp) > 0 {
		payload.ModelParams = mp
	}

	if request.N != nil && *request.N > 0 {
		payload.N = int(*request.N)
	}

	return payload, nil
}

// stringExtra reads a string value from request.Extra[key], "" if absent.
func stringExtra(request *dto.ImageRequest, key string) string {
	if raw, ok := request.Extra[key]; ok && len(raw) > 0 {
		var v string
		if common.Unmarshal(raw, &v) == nil {
			return strings.TrimSpace(v)
		}
	}
	return ""
}

// extractResolutionTier returns the requested tier as "0.5K"/"1K"/"2K"/"4K", or
// "" to let the upstream default apply. It reads the common resolution hints in
// priority order and falls back to a pixel-size / quality heuristic.
func extractResolutionTier(request *dto.ImageRequest) string {
	for _, key := range []string{"resolution", "image_size", "imageSize", "quality"} {
		if t := normalizeTier(stringExtra(request, key)); t != "" {
			return t
		}
	}
	if t := tierFromPixelSize(request.Size); t != "" {
		return t
	}
	switch strings.ToLower(strings.TrimSpace(request.Quality)) {
	case "hd":
		return "2K"
	}
	return ""
}

func normalizeTier(value string) string {
	switch strings.ToUpper(strings.TrimSpace(value)) {
	case "0.5K":
		return "0.5K"
	case "1K":
		return "1K"
	case "2K":
		return "2K"
	case "4K":
		return "4K"
	}
	return ""
}

func tierFromPixelSize(size string) string {
	s := strings.ToLower(strings.TrimSpace(size))
	switch {
	case strings.Contains(s, "4096") || strings.Contains(s, "3840") || strings.Contains(s, "2160"):
		return "4K"
	case strings.Contains(s, "2048") || strings.Contains(s, "3072"):
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
		return nil, fmt.Errorf("evolink: relay mode %d not supported", info.RelayMode)
	}
}

func (a *Adaptor) doAsyncImage(c *gin.Context, info *relaycommon.RelayInfo, requestBody io.Reader) (any, error) {
	submitURL, err := a.GetRequestURL(info)
	if err != nil {
		return nil, err
	}
	httpReq, err := http.NewRequestWithContext(c.Request.Context(), http.MethodPost, submitURL, requestBody)
	if err != nil {
		return nil, fmt.Errorf("evolink: new submit request failed: %w", err)
	}
	if err := a.SetupRequestHeader(c, &httpReq.Header, info); err != nil {
		return nil, err
	}

	resp, err := channel.DoRequest(c, httpReq, info)
	if err != nil {
		return nil, fmt.Errorf("evolink: submit failed: %w", err)
	}
	if resp.StatusCode != http.StatusOK {
		return resp, nil
	}
	defer resp.Body.Close()
	submitBody, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("evolink: read submit body failed: %w", err)
	}

	var sResp taskapimart.SubmitResponse
	if err := common.Unmarshal(submitBody, &sResp); err != nil {
		return nil, fmt.Errorf("evolink: unmarshal submit body failed: %w, body=%s", err, string(submitBody))
	}
	// Accepted() covers the flat ({id,object:"image.generation.task",status})
	// envelope Evolink returns.
	if !sResp.Accepted() {
		return synthesizeJSONResponse(http.StatusBadGateway, submitBody), nil
	}

	detailBody, err := a.pollUntilTerminal(c.Request.Context(), info, sResp.TaskID())
	if err != nil {
		return nil, err
	}
	return synthesizeJSONResponse(http.StatusOK, detailBody), nil
}

func (a *Adaptor) pollUntilTerminal(ctx context.Context, info *relaycommon.RelayInfo, taskID string) ([]byte, error) {
	client, err := service.GetHttpClientWithProxy(info.ChannelSetting.Proxy)
	if err != nil {
		return nil, fmt.Errorf("evolink: build poll client failed: %w", err)
	}
	detailURL := info.ChannelBaseUrl + PollPath(taskID)

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
			return nil, fmt.Errorf("evolink: poll timeout after %s, taskID=%s", pollTimeout, taskID)
		}

		req, err := http.NewRequestWithContext(ctx, http.MethodGet, detailURL, nil)
		if err != nil {
			return nil, err
		}
		req.Header.Set("Accept", "application/json")
		req.Header.Set("Authorization", "Bearer "+info.ApiKey)

		resp, err := client.Do(req)
		if err != nil {
			return nil, fmt.Errorf("evolink: poll detail failed: %w", err)
		}
		body, readErr := io.ReadAll(resp.Body)
		resp.Body.Close()
		if readErr != nil {
			return nil, fmt.Errorf("evolink: read poll body failed: %w", readErr)
		}
		if resp.StatusCode != http.StatusOK {
			return nil, fmt.Errorf("evolink: poll non-200: status=%d body=%s", resp.StatusCode, string(body))
		}

		var dResp taskapimart.DetailResponse
		if err := common.Unmarshal(body, &dResp); err != nil {
			return nil, fmt.Errorf("evolink: unmarshal detail failed: %w, body=%s", err, string(body))
		}
		// Not-ready (error envelope) ends the poll and lets finishAsyncImage surface
		// the error. A recursive URL fallback (collectResultURLs) covers result
		// shapes the struct parser doesn't model.
		if !dResp.Ready() {
			if len(collectResultURLs(body)) > 0 {
				return body, nil
			}
			return body, nil
		}
		if taskapimart.IsTerminal(dResp.EffectiveStatus()) || len(collectResultURLs(body)) > 0 {
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
		return nil, types.NewError(fmt.Errorf("evolink: relay mode %d not supported", info.RelayMode), types.ErrorCodeBadResponse)
	}
}

func (a *Adaptor) finishAsyncImage(c *gin.Context, resp *http.Response, info *relaycommon.RelayInfo) (any, *types.NewAPIError) {
	defer resp.Body.Close()
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, types.NewError(fmt.Errorf("read upstream body failed: %w", err), types.ErrorCodeReadResponseBodyFailed)
	}

	var dResp taskapimart.DetailResponse
	_ = common.Unmarshal(body, &dResp)
	status := dResp.EffectiveStatus()

	// Collect URLs from the struct parser first, then fall back to a recursive
	// scan that survives result-shape differences.
	urls := dResp.AllURLs()
	if len(urls) == 0 {
		urls = collectResultURLs(body)
	}

	if taskapimart.IsTerminal(status) && status != taskapimart.StatusCompleted && len(urls) == 0 {
		msg := dResp.FailureReason()
		if msg == "" {
			msg = "evolink image task " + status
		}
		return nil, types.NewErrorWithStatusCode(errors.New(msg), types.ErrorCodeBadResponse, http.StatusBadGateway)
	}
	if len(urls) == 0 {
		msg := dResp.FailureReason()
		if msg == "" {
			msg = fmt.Sprintf("evolink image task returned no result urls, body=%s", string(body))
		}
		return nil, types.NewErrorWithStatusCode(errors.New(msg), types.ErrorCodeBadResponse, http.StatusBadGateway)
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
		logger.LogError(c, fmt.Sprintf("evolink: write response failed: %v", werr))
	}
	return &dto.Usage{PromptTokens: 1, TotalTokens: 1}, nil
}

func (a *Adaptor) GetModelList() []string { return ModelList }

func (a *Adaptor) GetChannelName() string { return ChannelName }

// --- unsupported (image-only sync channel) ---

func (a *Adaptor) ConvertOpenAIRequest(c *gin.Context, info *relaycommon.RelayInfo, request *dto.GeneralOpenAIRequest) (any, error) {
	return nil, errors.New("evolink: chat/completions not supported (image-only channel)")
}

func (a *Adaptor) ConvertClaudeRequest(c *gin.Context, info *relaycommon.RelayInfo, request *dto.ClaudeRequest) (any, error) {
	return nil, errors.New("evolink: claude not supported (image-only channel)")
}

func (a *Adaptor) ConvertGeminiRequest(c *gin.Context, info *relaycommon.RelayInfo, request *dto.GeminiChatRequest) (any, error) {
	return nil, errors.New("evolink: gemini chat not supported (image-only channel)")
}

func (a *Adaptor) ConvertAudioRequest(c *gin.Context, info *relaycommon.RelayInfo, request dto.AudioRequest) (io.Reader, error) {
	return nil, errors.New("evolink: audio not supported (image-only channel)")
}

func (a *Adaptor) ConvertRerankRequest(c *gin.Context, relayMode int, request dto.RerankRequest) (any, error) {
	return nil, errors.New("evolink: rerank not supported (image-only channel)")
}

func (a *Adaptor) ConvertEmbeddingRequest(c *gin.Context, info *relaycommon.RelayInfo, request dto.EmbeddingRequest) (any, error) {
	return nil, errors.New("evolink: embedding not supported (image-only channel)")
}

func (a *Adaptor) ConvertOpenAIResponsesRequest(c *gin.Context, info *relaycommon.RelayInfo, request dto.OpenAIResponsesRequest) (any, error) {
	return nil, errors.New("evolink: responses not supported (image-only channel)")
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
