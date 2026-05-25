package wuyinkeji

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/dto"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/relay/channel"
	taskcommon "github.com/QuantumNous/new-api/relay/channel/task/taskcommon"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	"github.com/QuantumNous/new-api/service"

	"github.com/gin-gonic/gin"
	"github.com/pkg/errors"
)

// Per-model payload builders. Wuyinkeji accepts slightly different field names
// across models (e.g. NanoBanana uses `imageSize`, Pro/2 use `size`; veo3.1 has
// firstFrameUrl/lastFrameUrl). Clients may override any field via
// TaskSubmitReq.Metadata — metadata merges on top of the defaults.

type gptImagePayload struct {
	Prompt string   `json:"prompt"`
	Size   string   `json:"size,omitempty"`
	Urls   []string `json:"urls,omitempty"`
}

type nanoBananaPayload struct {
	Prompt      string   `json:"prompt"`
	ImageSize   string   `json:"imageSize,omitempty"`
	AspectRatio string   `json:"aspectRatio,omitempty"`
	Urls        []string `json:"urls,omitempty"`
}

type nanoBananaProPayload struct {
	Prompt      string   `json:"prompt"`
	Size        string   `json:"size,omitempty"`
	AspectRatio string   `json:"aspectRatio,omitempty"`
	Urls        []string `json:"urls,omitempty"`
}

type veo31Payload struct {
	Prompt        string   `json:"prompt"`
	FirstFrameUrl string   `json:"firstFrameUrl,omitempty"`
	LastFrameUrl  string   `json:"lastFrameUrl,omitempty"`
	Urls          []string `json:"urls,omitempty"`
	AspectRatio   string   `json:"aspectRatio,omitempty"`
	Size          string   `json:"size,omitempty"` // resolution: 720p / 1080p / 4K
}

// BuildPayload translates a new-api TaskSubmitReq into the wuyinkeji upstream
// payload for the given model. Exposed so the synchronous image adaptor
// (relay/channel/wuyinkeji) can reuse the same field mapping.
func BuildPayload(modelName string, req *relaycommon.TaskSubmitReq) (any, error) {
	requestedImageSize := normalizeImageSizeValue(readStringMetadata(req.Metadata, "image_size"))
	switch modelName {
	case "gpt-image-2-suchuang":
		p := gptImagePayload{
			Prompt: req.Prompt,
			Size:   taskcommon.DefaultString(req.Size, "auto"),
			Urls:   req.Images,
		}
		if requestedImageSize != "" {
			p.Size = requestedImageSize
		}
		if err := taskcommon.UnmarshalMetadata(req.Metadata, &p); err != nil {
			return nil, err
		}
		return p, nil
	case "nano-banana-fast-suchuang":
		p := nanoBananaPayload{
			Prompt:      req.Prompt,
			AspectRatio: taskcommon.DefaultString(req.Size, "1:1"),
			Urls:        req.Images,
		}
		if requestedImageSize != "" {
			p.ImageSize = requestedImageSize
		}
		if err := taskcommon.UnmarshalMetadata(req.Metadata, &p); err != nil {
			return nil, err
		}
		return p, nil
	case "nano-banana-pro-suchuang", "nanobanana2-suchuang":
		p := nanoBananaProPayload{
			Prompt:      req.Prompt,
			AspectRatio: taskcommon.DefaultString(req.Size, "1:1"),
			Urls:        req.Images,
		}
		if requestedImageSize != "" {
			p.Size = requestedImageSize
		}
		if err := taskcommon.UnmarshalMetadata(req.Metadata, &p); err != nil {
			return nil, err
		}
		return p, nil
	case "veo3.1-fast-suchuang", "veo3.1-pro-suchuang":
		p := veo31Payload{
			Prompt:      req.Prompt,
			Urls:        req.Images,
			AspectRatio: taskcommon.DefaultString(req.Size, "16:9"),
		}
		if err := taskcommon.UnmarshalMetadata(req.Metadata, &p); err != nil {
			return nil, err
		}
		return p, nil
	}
	return nil, fmt.Errorf("wuyinkeji: no payload builder for model %q", modelName)
}

func readStringMetadata(metadata map[string]any, key string) string {
	if metadata == nil {
		return ""
	}
	value, ok := metadata[key]
	if !ok {
		return ""
	}
	stringValue, ok := value.(string)
	if !ok {
		return ""
	}
	return strings.TrimSpace(stringValue)
}

func normalizeImageSizeValue(value string) string {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case "1080p", "1k":
		return "1K"
	case "2k":
		return "2K"
	default:
		return strings.TrimSpace(value)
	}
}

// SubmitResponse is the initial response from POST /api/async/image_gpt:
//
//	{ "code": 200, "msg": "成功", "data": { "id": "image_...", "count": "1" }, "exec_time": 0.29 }
//
// Upstream returns `count` as either a number or a quoted string depending on
// the model. We do not rely on it, so leave it as RawMessage to avoid a type
// mismatch from breaking the unmarshal.
type SubmitResponse struct {
	Code int    `json:"code"`
	Msg  string `json:"msg"`
	Data struct {
		ID    string          `json:"id"`
		Count json.RawMessage `json:"count,omitempty"`
	} `json:"data"`
	ExecTime float64 `json:"exec_time"`
}

// DetailResponse mirrors GET /api/async/detail. The result field name for the
// finished image/video is not uniformly documented across wuyinkeji models;
// we therefore accept any of the common shapes and pick the first non-empty
// one. Observed in the wild (gpt-image-2): results come back in `data.result`
// as a JSON array of URLs.
type DetailResponse struct {
	Code int    `json:"code"`
	Msg  string `json:"msg"`
	Data struct {
		Status    int      `json:"status"` // 0 init, 1 running, 2 success, 3 failed
		Message   string   `json:"message"`
		Result    []string `json:"result"`
		URL       string   `json:"url"`
		Image     string   `json:"image"`
		ImageURL  string   `json:"image_url"`
		ImageURLs []string `json:"image_urls"`
		URLs      []string `json:"urls"`
		Images    []string `json:"images"`
		VideoURL  string   `json:"video_url"`
	} `json:"data"`
}

// FirstURL returns the first non-empty result URL from the upstream detail
// response, trying all the field shapes wuyinkeji has been observed to use.
func (d *DetailResponse) FirstURL() string {
	switch {
	case len(d.Data.Result) > 0 && d.Data.Result[0] != "":
		return d.Data.Result[0]
	case d.Data.URL != "":
		return d.Data.URL
	case d.Data.ImageURL != "":
		return d.Data.ImageURL
	case d.Data.VideoURL != "":
		return d.Data.VideoURL
	case len(d.Data.ImageURLs) > 0:
		return d.Data.ImageURLs[0]
	case len(d.Data.URLs) > 0:
		return d.Data.URLs[0]
	case len(d.Data.Images) > 0:
		return d.Data.Images[0]
	case d.Data.Image != "":
		return d.Data.Image
	}
	return ""
}

type TaskAdaptor struct {
	taskcommon.BaseBilling
	ChannelType int
	apiKey      string
	baseURL     string
}

func (a *TaskAdaptor) Init(info *relaycommon.RelayInfo) {
	a.ChannelType = info.ChannelType
	a.baseURL = info.ChannelBaseUrl
	a.apiKey = info.ApiKey
}

func (a *TaskAdaptor) ValidateRequestAndSetAction(c *gin.Context, info *relaycommon.RelayInfo) *dto.TaskError {
	return relaycommon.ValidateBasicTaskRequest(c, info, constant.TaskActionGenerate)
}

func (a *TaskAdaptor) BuildRequestURL(info *relaycommon.RelayInfo) (string, error) {
	path, ok := ModelSubmitPath[info.UpstreamModelName]
	if !ok {
		return "", fmt.Errorf("wuyinkeji: unsupported model %q", info.UpstreamModelName)
	}
	return a.baseURL + path, nil
}

func (a *TaskAdaptor) BuildRequestHeader(c *gin.Context, req *http.Request, info *relaycommon.RelayInfo) error {
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json")
	// Wuyinkeji uses the raw API key in the Authorization header (no "Bearer " prefix).
	req.Header.Set("Authorization", a.apiKey)
	return nil
}

func (a *TaskAdaptor) BuildRequestBody(c *gin.Context, info *relaycommon.RelayInfo) (io.Reader, error) {
	v, exists := c.Get("task_request")
	if !exists {
		return nil, fmt.Errorf("request not found in context")
	}
	req, ok := v.(relaycommon.TaskSubmitReq)
	if !ok {
		return nil, fmt.Errorf("invalid request type in context")
	}

	body, err := BuildPayload(info.UpstreamModelName, &req)
	if err != nil {
		return nil, errors.Wrap(err, "build payload failed")
	}

	data, err := common.Marshal(body)
	if err != nil {
		return nil, err
	}
	return bytes.NewReader(data), nil
}

func (a *TaskAdaptor) DoRequest(c *gin.Context, info *relaycommon.RelayInfo, requestBody io.Reader) (*http.Response, error) {
	return channel.DoTaskApiRequest(a, c, info, requestBody)
}

func (a *TaskAdaptor) DoResponse(c *gin.Context, resp *http.Response, info *relaycommon.RelayInfo) (taskID string, taskData []byte, taskErr *dto.TaskError) {
	responseBody, err := io.ReadAll(resp.Body)
	if err != nil {
		taskErr = service.TaskErrorWrapper(err, "read_response_body_failed", http.StatusInternalServerError)
		return
	}
	_ = resp.Body.Close()

	var sResp SubmitResponse
	if err := common.Unmarshal(responseBody, &sResp); err != nil {
		taskErr = service.TaskErrorWrapper(errors.Wrapf(err, "body: %s", responseBody), "unmarshal_response_body_failed", http.StatusInternalServerError)
		return
	}
	if sResp.Code != 200 || sResp.Data.ID == "" {
		taskErr = service.TaskErrorWrapper(fmt.Errorf("%s", sResp.Msg), fmt.Sprintf("%d", sResp.Code), http.StatusInternalServerError)
		return
	}

	ov := dto.NewOpenAIVideo()
	ov.ID = info.PublicTaskID
	ov.TaskID = info.PublicTaskID
	ov.CreatedAt = time.Now().Unix()
	ov.Model = info.OriginModelName
	c.JSON(http.StatusOK, ov)

	return sResp.Data.ID, responseBody, nil
}

func (a *TaskAdaptor) FetchTask(baseUrl, key string, body map[string]any, proxy string) (*http.Response, error) {
	taskID, ok := body["task_id"].(string)
	if !ok {
		return nil, fmt.Errorf("invalid task_id")
	}
	uri := fmt.Sprintf("%s/api/async/detail?id=%s", baseUrl, url.QueryEscape(taskID))
	req, err := http.NewRequest(http.MethodGet, uri, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Accept", "application/json")
	req.Header.Set("Authorization", key)

	client, err := service.GetHttpClientWithProxy(proxy)
	if err != nil {
		return nil, fmt.Errorf("new proxy http client failed: %w", err)
	}
	return client.Do(req)
}

func (a *TaskAdaptor) GetModelList() []string {
	names := make([]string, 0, len(ModelSubmitPath))
	for k := range ModelSubmitPath {
		names = append(names, k)
	}
	return names
}

func (a *TaskAdaptor) GetChannelName() string {
	return ChannelName
}

func (a *TaskAdaptor) ParseTaskResult(respBody []byte) (*relaycommon.TaskInfo, error) {
	var dResp DetailResponse
	if err := common.Unmarshal(respBody, &dResp); err != nil {
		return nil, errors.Wrap(err, "unmarshal task result failed")
	}

	info := &relaycommon.TaskInfo{Code: dResp.Code}
	if dResp.Code != 200 {
		info.Status = model.TaskStatusFailure
		info.Reason = dResp.Msg
		info.Progress = taskcommon.ProgressComplete
		return info, nil
	}

	switch dResp.Data.Status {
	case 0:
		info.Status = model.TaskStatusQueued
		info.Progress = taskcommon.ProgressQueued
	case 1:
		info.Status = model.TaskStatusInProgress
		info.Progress = taskcommon.ProgressInProgress
	case 2:
		info.Status = model.TaskStatusSuccess
		info.Progress = taskcommon.ProgressComplete
		info.Url = dResp.FirstURL()
	case 3:
		info.Status = model.TaskStatusFailure
		info.Progress = taskcommon.ProgressComplete
		info.Reason = dResp.Data.Message
	default:
		info.Status = model.TaskStatusInProgress
		info.Progress = taskcommon.ProgressInProgress
	}
	return info, nil
}
