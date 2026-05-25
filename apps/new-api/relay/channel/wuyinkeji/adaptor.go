package wuyinkeji

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/dto"
	"github.com/QuantumNous/new-api/logger"
	"github.com/QuantumNous/new-api/relay/channel"
	"github.com/QuantumNous/new-api/relay/channel/imageutil"
	taskwuyinkeji "github.com/QuantumNous/new-api/relay/channel/task/wuyinkeji"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	"github.com/QuantumNous/new-api/service"
	"github.com/QuantumNous/new-api/types"

	"github.com/gin-gonic/gin"
)

// Adaptor wraps wuyinkeji's async submit + detail-poll flow behind new-api's
// synchronous image channel interface. Image models that would otherwise need
// the task submit/poll round-trip are exposed via /v1/images/generations and
// block on an in-process poll loop until the upstream task reaches a terminal
// state. Video models continue to use the task adaptor.
type Adaptor struct{}

func (a *Adaptor) Init(info *relaycommon.RelayInfo) {}

func (a *Adaptor) GetRequestURL(info *relaycommon.RelayInfo) (string, error) {
	path, ok := taskwuyinkeji.ModelSubmitPath[info.UpstreamModelName]
	if !ok {
		return "", fmt.Errorf("wuyinkeji: unsupported model %q", info.UpstreamModelName)
	}
	return info.ChannelBaseUrl + path, nil
}

func (a *Adaptor) SetupRequestHeader(c *gin.Context, header *http.Header, info *relaycommon.RelayInfo) error {
	header.Set("Content-Type", "application/json")
	header.Set("Accept", "application/json")
	// Wuyinkeji uses the raw API key in Authorization (no "Bearer " prefix).
	header.Set("Authorization", info.ApiKey)
	return nil
}

func (a *Adaptor) ConvertImageRequest(c *gin.Context, info *relaycommon.RelayInfo, request dto.ImageRequest) (any, error) {
	if !taskwuyinkeji.IsImageModel(info.UpstreamModelName) {
		return nil, fmt.Errorf("wuyinkeji sync adaptor: unsupported model %q", info.UpstreamModelName)
	}

	refs := imageutil.ExtractReferenceImages(&request)

	req := &relaycommon.TaskSubmitReq{
		Prompt: request.Prompt,
		Model:  info.UpstreamModelName,
		Size:   request.Size,
		Images: refs,
	}

	if raw, ok := request.Extra["metadata"]; ok && len(raw) > 0 {
		var meta map[string]any
		if err := common.Unmarshal(raw, &meta); err == nil {
			req.Metadata = meta
		}
	}
	if imageSize := imageutil.ExtractRequestedImageSize(&request); imageSize != "" {
		if req.Metadata == nil {
			req.Metadata = map[string]any{}
		}
		req.Metadata["image_size"] = imageSize
	}

	return taskwuyinkeji.BuildPayload(info.UpstreamModelName, req)
}

func (a *Adaptor) DoRequest(c *gin.Context, info *relaycommon.RelayInfo, requestBody io.Reader) (any, error) {
	submitURL, err := a.GetRequestURL(info)
	if err != nil {
		return nil, err
	}

	req, err := http.NewRequestWithContext(c.Request.Context(), http.MethodPost, submitURL, requestBody)
	if err != nil {
		return nil, fmt.Errorf("new submit request failed: %w", err)
	}
	if err := a.SetupRequestHeader(c, &req.Header, info); err != nil {
		return nil, err
	}

	resp, err := channel.DoRequest(c, req, info)
	if err != nil {
		return nil, fmt.Errorf("submit failed: %w", err)
	}
	// Upstream transport-level errors surface through ImageHelper's status check.
	if resp.StatusCode != http.StatusOK {
		return resp, nil
	}

	defer resp.Body.Close()
	submitBody, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("read submit body failed: %w", err)
	}

	var sResp taskwuyinkeji.SubmitResponse
	if err := common.Unmarshal(submitBody, &sResp); err != nil {
		return nil, fmt.Errorf("unmarshal submit body failed: %w, body=%s", err, string(submitBody))
	}
	if sResp.Code != 200 || sResp.Data.ID == "" {
		return synthesizeJSONResponse(http.StatusBadGateway, submitBody), nil
	}

	detailBody, err := a.pollUntilTerminal(c.Request.Context(), info, sResp.Data.ID)
	if err != nil {
		return nil, err
	}
	return synthesizeJSONResponse(http.StatusOK, detailBody), nil
}

func (a *Adaptor) pollUntilTerminal(ctx context.Context, info *relaycommon.RelayInfo, taskID string) ([]byte, error) {
	client, err := service.GetHttpClientWithProxy(info.ChannelSetting.Proxy)
	if err != nil {
		return nil, fmt.Errorf("build poll client failed: %w", err)
	}
	detailURL := fmt.Sprintf("%s/api/async/detail?id=%s", info.ChannelBaseUrl, url.QueryEscape(taskID))

	interval := 1500 * time.Millisecond
	const maxInterval = 5 * time.Second

	for {
		select {
		case <-ctx.Done():
			return nil, ctx.Err()
		case <-time.After(interval):
		}

		req, err := http.NewRequestWithContext(ctx, http.MethodGet, detailURL, nil)
		if err != nil {
			return nil, err
		}
		req.Header.Set("Accept", "application/json")
		req.Header.Set("Authorization", info.ApiKey)

		resp, err := client.Do(req)
		if err != nil {
			return nil, fmt.Errorf("poll detail failed: %w", err)
		}
		body, readErr := io.ReadAll(resp.Body)
		resp.Body.Close()
		if readErr != nil {
			return nil, fmt.Errorf("read poll body failed: %w", readErr)
		}
		if resp.StatusCode != http.StatusOK {
			return nil, fmt.Errorf("poll non-200: status=%d body=%s", resp.StatusCode, string(body))
		}

		var dResp taskwuyinkeji.DetailResponse
		if err := common.Unmarshal(body, &dResp); err != nil {
			return nil, fmt.Errorf("unmarshal detail failed: %w, body=%s", err, string(body))
		}
		if dResp.Code != 200 || dResp.Data.Status == 2 || dResp.Data.Status == 3 {
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

func (a *Adaptor) DoResponse(c *gin.Context, resp *http.Response, info *relaycommon.RelayInfo) (any, *types.NewAPIError) {
	defer resp.Body.Close()
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, types.NewError(fmt.Errorf("read upstream body failed: %w", err), types.ErrorCodeReadResponseBodyFailed)
	}
	if common.DebugEnabled {
		logger.LogDebug(c, fmt.Sprintf("image upstream response body: %s", string(body)))
	}

	var dResp taskwuyinkeji.DetailResponse
	if err := common.Unmarshal(body, &dResp); err != nil {
		return nil, types.NewError(fmt.Errorf("unmarshal detail failed: %w, body=%s", err, string(body)), types.ErrorCodeBadResponseBody)
	}

	if dResp.Code != 200 {
		msg := dResp.Msg
		if msg == "" {
			msg = fmt.Sprintf("wuyinkeji upstream code=%d", dResp.Code)
		}
		return nil, types.NewErrorWithStatusCode(errors.New(msg), types.ErrorCodeBadResponse, http.StatusBadGateway)
	}
	if dResp.Data.Status == 3 {
		msg := dResp.Data.Message
		if msg == "" {
			msg = "wuyinkeji task failed"
		}
		return nil, types.NewErrorWithStatusCode(errors.New(msg), types.ErrorCodeBadResponse, http.StatusBadGateway)
	}
	if dResp.Data.Status != 2 {
		return nil, types.NewErrorWithStatusCode(
			fmt.Errorf("wuyinkeji non-terminal status %d leaked to DoResponse", dResp.Data.Status),
			types.ErrorCodeBadResponse, http.StatusBadGateway)
	}

	finalURL := dResp.FirstURL()
	if finalURL == "" {
		return nil, types.NewErrorWithStatusCode(
			fmt.Errorf("wuyinkeji success but empty result URL, body=%s", string(body)),
			types.ErrorCodeBadResponse, http.StatusBadGateway)
	}

	payload := dto.ImageResponse{
		Created: time.Now().Unix(),
		Data:    []dto.ImageData{{Url: finalURL}},
	}
	data, err := common.Marshal(payload)
	if err != nil {
		return nil, types.NewError(fmt.Errorf("marshal image response failed: %w", err), types.ErrorCodeBadResponseBody)
	}

	c.Writer.Header().Set("Content-Type", "application/json")
	c.Writer.WriteHeader(http.StatusOK)
	if _, err := c.Writer.Write(data); err != nil {
		logger.LogError(c, fmt.Sprintf("wuyinkeji: write response failed: %v", err))
	}

	return &dto.Usage{PromptTokens: 1, TotalTokens: 1}, nil
}

func (a *Adaptor) GetModelList() []string {
	return ModelList
}

func (a *Adaptor) GetChannelName() string {
	return ChannelName
}

// Unsupported request shapes -------------------------------------------------

func (a *Adaptor) ConvertOpenAIRequest(*gin.Context, *relaycommon.RelayInfo, *dto.GeneralOpenAIRequest) (any, error) {
	return nil, errors.New("wuyinkeji: chat completions not supported")
}

func (a *Adaptor) ConvertRerankRequest(*gin.Context, int, dto.RerankRequest) (any, error) {
	return nil, errors.New("wuyinkeji: rerank not supported")
}

func (a *Adaptor) ConvertEmbeddingRequest(*gin.Context, *relaycommon.RelayInfo, dto.EmbeddingRequest) (any, error) {
	return nil, errors.New("wuyinkeji: embeddings not supported")
}

func (a *Adaptor) ConvertAudioRequest(*gin.Context, *relaycommon.RelayInfo, dto.AudioRequest) (io.Reader, error) {
	return nil, errors.New("wuyinkeji: audio not supported")
}

func (a *Adaptor) ConvertOpenAIResponsesRequest(*gin.Context, *relaycommon.RelayInfo, dto.OpenAIResponsesRequest) (any, error) {
	return nil, errors.New("wuyinkeji: responses API not supported")
}

func (a *Adaptor) ConvertClaudeRequest(*gin.Context, *relaycommon.RelayInfo, *dto.ClaudeRequest) (any, error) {
	return nil, errors.New("wuyinkeji: claude messages not supported")
}

func (a *Adaptor) ConvertGeminiRequest(*gin.Context, *relaycommon.RelayInfo, *dto.GeminiChatRequest) (any, error) {
	return nil, errors.New("wuyinkeji: gemini not supported")
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
