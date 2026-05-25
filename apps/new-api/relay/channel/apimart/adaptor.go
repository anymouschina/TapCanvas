package apimart

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
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/relay/channel"
	"github.com/QuantumNous/new-api/relay/channel/imageutil"
	"github.com/QuantumNous/new-api/relay/channel/openai"
	taskapimart "github.com/QuantumNous/new-api/relay/channel/task/apimart"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	"github.com/QuantumNous/new-api/relay/constant"
	"github.com/QuantumNous/new-api/service"
	"github.com/QuantumNous/new-api/types"

	"github.com/gin-gonic/gin"
)

// Adaptor handles APIMart's synchronous routes:
//
//   - /v1/chat/completions        (OpenAI-compatible, pass-through)
//   - /v1/audio/*                 (whisper-1 transcription, gpt-4o-mini-tts)
//   - /v1/images/generations      (APIMart is actually async; this adaptor
//     sync-wraps the submit → poll cycle so
//     OpenAI-SDK clients keep working)
//
// Async video is served by relay/channel/task/apimart (TaskAdaptor).
type Adaptor struct{}

func (a *Adaptor) Init(info *relaycommon.RelayInfo) {}

func (a *Adaptor) GetRequestURL(info *relaycommon.RelayInfo) (string, error) {
	switch info.RelayMode {
	case constant.RelayModeImagesGenerations, constant.RelayModeImagesEdits:
		// APIMart images are async. We emit the submit URL here; DoRequest
		// drives the poll loop internally and synthesizes a sync response.
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

// ConvertImageRequest wraps the OpenAI-style ImageRequest into APIMart's async
// submit payload. The marshaled body is what DoRequest POSTs to submit.
func (a *Adaptor) ConvertImageRequest(c *gin.Context, info *relaycommon.RelayInfo, request dto.ImageRequest) (any, error) {
	// Only reject models that are explicitly non-image (video, chat, audio, etc.).
	// An empty kind means the model has no kind recorded in the DB — that is
	// not a reason to block it on an /images/ endpoint; treat it as image.
	if kind := model.GetModelKind(info.UpstreamModelName); kind != "" && kind != "image" && kind != "image_edit" {
		return nil, fmt.Errorf("apimart: %q is not an image model (kind=%q) — use the task API for video/audio", info.UpstreamModelName, kind)
	}
	refs := imageutil.ExtractReferenceImages(&request)

	// --- size (aspect ratio) ---
	// Use known "size" field first; fall back to "aspect_ratio" extra.
	size := request.Size
	if size == "" {
		if raw, ok := request.Extra["aspect_ratio"]; ok && len(raw) > 0 {
			var ar string
			if err := common.Unmarshal(raw, &ar); err == nil {
				size = strings.TrimSpace(ar)
			}
		}
	}

	// --- resolution ---
	// Prefer "resolution" extra; accept "image_size" as alias.
	resolution := ""
	if raw, ok := request.Extra["resolution"]; ok && len(raw) > 0 {
		var res string
		if err := common.Unmarshal(raw, &res); err == nil {
			resolution = strings.TrimSpace(res)
		}
	}
	if resolution == "" {
		if imgSize := imageutil.ExtractRequestedImageSize(&request); imgSize != "" {
			resolution = imgSize
		}
	}

	// --- pass-through extras ---
	// Forward all unknown Extra fields (num_images, variants, seed, n, …) to
	// APIMart as-is. APIMart silently drops fields it doesn't recognise, so
	// this is safe and avoids losing model-specific parameters.
	// Keys handled above are excluded to avoid duplication.
	skipKeys := map[string]bool{
		"resolution": true, "image_size": true, "imageSize": true,
		"aspect_ratio": true, "metadata": true,
	}
	meta := make(map[string]any)
	for k, v := range request.Extra {
		if skipKeys[k] {
			continue
		}
		var val any
		if err := common.Unmarshal(v, &val); err == nil {
			meta[k] = val
		}
	}
	// Merge explicit "metadata" extra on top (lower priority than top-level extras).
	if raw, ok := request.Extra["metadata"]; ok && len(raw) > 0 {
		var explicit map[string]any
		if err := common.Unmarshal(raw, &explicit); err == nil {
			for k, v := range explicit {
				if _, exists := meta[k]; !exists {
					meta[k] = v
				}
			}
		}
	}
	// Forward "n" from the known ImageRequest field when not already in extras.
	if request.N != nil {
		if _, exists := meta["n"]; !exists {
			meta["n"] = int(*request.N)
		}
	}
	if len(meta) == 0 {
		meta = nil
	}

	taskReq := &relaycommon.TaskSubmitReq{
		Model:      info.UpstreamModelName,
		Prompt:     request.Prompt,
		Size:       size,
		Resolution: resolution,
		Images:     refs,
		Metadata:   meta,
	}
	return taskapimart.BuildSubmitPayload(taskReq)
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

// DoRequest routes image/edits through the sync-wrap poll loop and everything
// else through the stock chat/audio pass-through.
func (a *Adaptor) DoRequest(c *gin.Context, info *relaycommon.RelayInfo, requestBody io.Reader) (any, error) {
	switch info.RelayMode {
	case constant.RelayModeImagesGenerations, constant.RelayModeImagesEdits:
		return a.doAsyncImage(c, info, requestBody)
	default:
		return channel.DoApiRequest(a, c, info, requestBody)
	}
}

// doAsyncImage POSTs the submit body, then polls /v1/tasks/{id} until the task
// reaches a terminal state, returning a synthesized http.Response that the
// standard DoResponse path can consume like a sync upstream.
func (a *Adaptor) doAsyncImage(c *gin.Context, info *relaycommon.RelayInfo, requestBody io.Reader) (any, error) {
	submitURL, err := a.GetRequestURL(info)
	if err != nil {
		return nil, err
	}
	httpReq, err := http.NewRequestWithContext(c.Request.Context(), http.MethodPost, submitURL, requestBody)
	if err != nil {
		return nil, fmt.Errorf("apimart: new submit request failed: %w", err)
	}
	if err := a.SetupRequestHeader(c, &httpReq.Header, info); err != nil {
		return nil, err
	}

	resp, err := channel.DoRequest(c, httpReq, info)
	if err != nil {
		return nil, fmt.Errorf("apimart: submit failed: %w", err)
	}
	if resp.StatusCode != http.StatusOK {
		return resp, nil
	}

	defer resp.Body.Close()
	submitBody, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("apimart: read submit body failed: %w", err)
	}
	var sResp taskapimart.SubmitResponse
	if err := common.Unmarshal(submitBody, &sResp); err != nil {
		return nil, fmt.Errorf("apimart: unmarshal submit body failed: %w, body=%s", err, string(submitBody))
	}
	taskID := sResp.TaskID()
	if sResp.Code != 200 || taskID == "" {
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
		return nil, fmt.Errorf("apimart: build poll client failed: %w", err)
	}
	detailURL := info.ChannelBaseUrl + taskapimart.PollPath(taskID)

	// Use RELAY_TIMEOUT if set, otherwise default to 15 minutes.
	// APIMart image tasks can legitimately take 10+ minutes.
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
			return nil, fmt.Errorf("apimart: poll timeout after %s, taskID=%s", pollTimeout, taskID)
		}

		req, err := http.NewRequestWithContext(ctx, http.MethodGet, detailURL, nil)
		if err != nil {
			return nil, err
		}
		req.Header.Set("Accept", "application/json")
		req.Header.Set("Authorization", "Bearer "+info.ApiKey)

		resp, err := client.Do(req)
		if err != nil {
			return nil, fmt.Errorf("apimart: poll detail failed: %w", err)
		}
		body, readErr := io.ReadAll(resp.Body)
		resp.Body.Close()
		if readErr != nil {
			return nil, fmt.Errorf("apimart: read poll body failed: %w", readErr)
		}
		if resp.StatusCode != http.StatusOK {
			return nil, fmt.Errorf("apimart: poll non-200: status=%d body=%s", resp.StatusCode, string(body))
		}

		var dResp taskapimart.DetailResponse
		if err := common.Unmarshal(body, &dResp); err != nil {
			return nil, fmt.Errorf("apimart: unmarshal detail failed: %w, body=%s", err, string(body))
		}
		if dResp.Code != 200 || dResp.Data == nil {
			return body, nil
		}
		if taskapimart.IsTerminal(dResp.Data.Status) {
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

// DoResponse emits an OpenAI-compatible ImageResponse for async image results
// and otherwise delegates to the standard openai adaptor.
func (a *Adaptor) DoResponse(c *gin.Context, resp *http.Response, info *relaycommon.RelayInfo) (usage any, err *types.NewAPIError) {
	switch info.RelayMode {
	case constant.RelayModeImagesGenerations, constant.RelayModeImagesEdits:
		return a.finishAsyncImage(c, resp, info)
	default:
		adaptor := openai.Adaptor{}
		return adaptor.DoResponse(c, resp, info)
	}
}

func (a *Adaptor) finishAsyncImage(c *gin.Context, resp *http.Response, info *relaycommon.RelayInfo) (any, *types.NewAPIError) {
	defer resp.Body.Close()
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, types.NewError(fmt.Errorf("read upstream body failed: %w", err), types.ErrorCodeReadResponseBodyFailed)
	}

	var dResp taskapimart.DetailResponse
	if err := common.Unmarshal(body, &dResp); err != nil {
		return nil, types.NewError(fmt.Errorf("unmarshal detail failed: %w, body=%s", err, string(body)), types.ErrorCodeBadResponseBody)
	}
	if dResp.Code != 200 || dResp.Data == nil {
		msg := dResp.FailureReason()
		if msg == "" {
			msg = fmt.Sprintf("apimart upstream code=%d", dResp.Code)
		}
		return nil, types.NewErrorWithStatusCode(errors.New(msg), types.ErrorCodeBadResponse, http.StatusBadGateway)
	}
	switch dResp.Data.Status {
	case taskapimart.StatusCompleted:
		// fall through
	case taskapimart.StatusFailed, taskapimart.StatusCancelled:
		msg := dResp.FailureReason()
		if msg == "" {
			msg = "apimart task " + dResp.Data.Status
		}
		return nil, types.NewErrorWithStatusCode(errors.New(msg), types.ErrorCodeBadResponse, http.StatusBadGateway)
	default:
		return nil, types.NewErrorWithStatusCode(
			fmt.Errorf("apimart non-terminal status %q leaked to DoResponse", dResp.Data.Status),
			types.ErrorCodeBadResponse, http.StatusBadGateway)
	}

	urls := dResp.AllURLs()
	if len(urls) == 0 {
		return nil, types.NewErrorWithStatusCode(
			fmt.Errorf("apimart task succeeded with no result urls, body=%s", string(body)),
			types.ErrorCodeBadResponse, http.StatusBadGateway)
	}

	payload := dto.ImageResponse{Created: time.Now().Unix()}
	for _, u := range urls {
		payload.Data = append(payload.Data, dto.ImageData{Url: u})
	}
	data, err := common.Marshal(payload)
	if err != nil {
		return nil, types.NewError(fmt.Errorf("marshal image response failed: %w", err), types.ErrorCodeBadResponseBody)
	}

	c.Writer.Header().Set("Content-Type", "application/json")
	c.Writer.WriteHeader(http.StatusOK)
	if _, werr := c.Writer.Write(data); werr != nil {
		logger.LogError(c, fmt.Sprintf("apimart: write response failed: %v", werr))
	}
	return &dto.Usage{PromptTokens: 1, TotalTokens: 1}, nil
}

func (a *Adaptor) GetModelList() []string { return ModelList }

func (a *Adaptor) GetChannelName() string { return ChannelName }

// extractReferenceImages pulls reference image URLs from an OpenAI-style
// ImageRequest. Accepts `image` (single or array) and several common Extra
// keys used by APIMart docs.
func extractReferenceImages(request *dto.ImageRequest) []string {
	out := []string{}

	appendFromRaw := func(raw []byte) {
		if len(raw) == 0 {
			return
		}
		var arr []string
		if err := common.Unmarshal(raw, &arr); err == nil {
			for _, s := range arr {
				if s = strings.TrimSpace(s); s != "" {
					out = append(out, s)
				}
			}
			return
		}
		var s string
		if err := common.Unmarshal(raw, &s); err == nil {
			if s = strings.TrimSpace(s); s != "" {
				out = append(out, s)
			}
		}
	}

	appendFromRaw(request.Image)
	for _, key := range []string{"image_urls", "images", "urls", "input_reference"} {
		if raw, ok := request.Extra[key]; ok {
			appendFromRaw(raw)
		}
	}
	return out
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
