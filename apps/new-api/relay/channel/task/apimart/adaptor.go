package apimart

import (
	"bytes"
	"fmt"
	"io"
	"net/http"
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

// TaskAdaptor drives APIMart's unified async flow:
//
//	submit → POST {base}/v1/{images,videos}/generations   (returns task_id)
//	poll   → GET  {base}/v1/tasks/{task_id}               (returns status+result)
//
// Unlike wuyinkeji's per-model submit paths, APIMart splits only by image vs
// video. Per-model parameter differences (duration, aspect_ratio, resolution,
// sequential_image_generation, etc.) are forwarded via SubmitPayload.Extras
// which merges TaskSubmitReq.Metadata on top of the canonical fields.
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
	kind := model.GetModelKind(info.UpstreamModelName)
	path, ok := SubmitPath(info.UpstreamModelName, kind)
	if !ok {
		return "", fmt.Errorf("apimart: unknown model kind for %q (kind=%q); ensure the model is configured in new-api with a valid kind", info.UpstreamModelName, kind)
	}
	return a.baseURL + path, nil
}

func (a *TaskAdaptor) BuildRequestHeader(c *gin.Context, req *http.Request, info *relaycommon.RelayInfo) error {
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json")
	req.Header.Set("Authorization", "Bearer "+a.apiKey)
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

	// Upstream model string is the billable model (OriginModelName may be the
	// user-facing alias). Keep billing stable by passing the upstream name.
	req.Model = info.UpstreamModelName

	payload, err := BuildSubmitPayload(&req)
	if err != nil {
		return nil, errors.Wrap(err, "build payload failed")
	}

	if requiresAssetConversion(info.UpstreamModelName) {
		if err := resolvePayloadAssets(payload, a.baseURL, a.apiKey); err != nil {
			return nil, errors.Wrap(err, "resolve asset urls failed")
		}
	}

	data, err := common.Marshal(payload)
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
		taskErr = service.TaskErrorWrapper(errors.Wrapf(err, "body: %s", responseBody),
			"unmarshal_response_body_failed", http.StatusInternalServerError)
		return
	}
	upstreamTaskID := sResp.TaskID()
	if sResp.Code != 200 || upstreamTaskID == "" {
		msg := sResp.ErrorMessage()
		if msg == "" {
			msg = fmt.Sprintf("apimart submit non-200: %d", sResp.Code)
		}
		taskErr = service.TaskErrorWrapper(fmt.Errorf("%s", msg), fmt.Sprintf("%d", sResp.Code), http.StatusInternalServerError)
		return
	}

	ov := dto.NewOpenAIVideo()
	ov.ID = info.PublicTaskID
	ov.TaskID = info.PublicTaskID
	ov.CreatedAt = time.Now().Unix()
	ov.Model = info.OriginModelName
	c.JSON(http.StatusOK, ov)

	return upstreamTaskID, responseBody, nil
}

func (a *TaskAdaptor) FetchTask(baseUrl, key string, body map[string]any, proxy string) (*http.Response, error) {
	taskID, ok := body["task_id"].(string)
	if !ok || taskID == "" {
		return nil, fmt.Errorf("invalid task_id")
	}
	uri := baseUrl + PollPath(taskID)
	req, err := http.NewRequest(http.MethodGet, uri, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Accept", "application/json")
	req.Header.Set("Authorization", "Bearer "+key)

	client, err := service.GetHttpClientWithProxy(proxy)
	if err != nil {
		return nil, fmt.Errorf("new proxy http client failed: %w", err)
	}
	return client.Do(req)
}

func (a *TaskAdaptor) GetModelList() []string { return AllAsyncModels() }

func (a *TaskAdaptor) GetChannelName() string { return ChannelName }

func (a *TaskAdaptor) ParseTaskResult(respBody []byte) (*relaycommon.TaskInfo, error) {
	var dResp DetailResponse
	if err := common.Unmarshal(respBody, &dResp); err != nil {
		return nil, errors.Wrap(err, "unmarshal task result failed")
	}

	info := &relaycommon.TaskInfo{Code: dResp.Code}
	if dResp.Code != 200 || dResp.Data == nil {
		info.Status = model.TaskStatusFailure
		info.Reason = dResp.FailureReason()
		info.Progress = taskcommon.ProgressComplete
		return info, nil
	}

	info.Progress = clampProgress(dResp.Data.Progress)
	switch dResp.Data.Status {
	case StatusPending:
		info.Status = model.TaskStatusQueued
	case StatusProcessing:
		info.Status = model.TaskStatusInProgress
	case StatusCompleted:
		info.Status = model.TaskStatusSuccess
		info.Progress = taskcommon.ProgressComplete
		info.Url = dResp.FirstURL()
	case StatusFailed:
		info.Status = model.TaskStatusFailure
		info.Progress = taskcommon.ProgressComplete
		info.Reason = dResp.FailureReason()
	case StatusCancelled:
		info.Status = model.TaskStatusFailure
		info.Progress = taskcommon.ProgressComplete
		info.Reason = "cancelled"
	default:
		info.Status = model.TaskStatusInProgress
	}
	return info, nil
}

// ConvertToOpenAIVideo implements channel.OpenAIVideoConverter so new-api's
// GET /v1/videos/{task_id} endpoint (OpenAI Sora-style) can surface APIMart
// task state to SDK clients. The stored task.Data is the most recent poll
// body from GET /v1/tasks/{task_id}; we unpack it into dto.OpenAIVideo.
func (a *TaskAdaptor) ConvertToOpenAIVideo(originTask *model.Task) ([]byte, error) {
	openAIVideo := dto.NewOpenAIVideo()
	openAIVideo.ID = originTask.TaskID
	openAIVideo.TaskID = originTask.TaskID
	openAIVideo.Status = originTask.Status.ToVideoStatus()
	openAIVideo.SetProgressStr(originTask.Progress)
	openAIVideo.CreatedAt = originTask.CreatedAt
	openAIVideo.CompletedAt = originTask.UpdatedAt
	openAIVideo.Model = originTask.Properties.OriginModelName

	if len(originTask.Data) > 0 {
		var dResp DetailResponse
		if err := common.Unmarshal(originTask.Data, &dResp); err == nil {
			if url := dResp.FirstURL(); url != "" {
				openAIVideo.SetMetadata("url", url)
			}
			if dResp.Data != nil && dResp.Data.Result != nil && dResp.Data.Result.ThumbnailURL != "" {
				openAIVideo.SetMetadata("thumbnail_url", dResp.Data.Result.ThumbnailURL)
			}
			if reason := dResp.FailureReason(); reason != "" &&
				(originTask.Status == model.TaskStatusFailure || originTask.Status == model.TaskStatusUnknown) {
				openAIVideo.Error = &dto.OpenAIVideoError{Message: reason}
			}
		}
	}

	return common.Marshal(openAIVideo)
}

// clampProgress maps APIMart's 0..100 integer progress to new-api's
// string progress representation expected by taskcommon helpers.
func clampProgress(pct int) string {
	if pct <= 0 {
		return taskcommon.ProgressQueued
	}
	if pct >= 100 {
		return taskcommon.ProgressComplete
	}
	return fmt.Sprintf("%d%%", pct)
}
