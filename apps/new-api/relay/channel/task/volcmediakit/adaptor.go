package volcmediakit

import (
	"bytes"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/dto"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/relay/channel"
	"github.com/QuantumNous/new-api/relay/channel/task/taskcommon"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	"github.com/QuantumNous/new-api/service"

	"github.com/gin-gonic/gin"
	"github.com/pkg/errors"
)

// TaskAdaptor drives VolcEngine MediaKit's async video-tool flow:
//
//	submit → POST {base}/api/v1/tools/{tool}           (returns task_id)
//	poll   → GET  {base}/api/v1/tasks/{task_id}        (status + result.video_url)
//
// Auth is a plain Bearer token (the MediaKit API Key held by the channel),
// NOT VolcEngine V4 signing. The model id selects the upstream tool and its
// billing contract: enhancement uses the legacy version/resolution/fps matrix;
// subtitle erasure and matting use the model's duration pricing in new-api.
type TaskAdaptor struct {
	taskcommon.BaseBilling
	apiKey  string
	baseURL string
	model   string
}

func (a *TaskAdaptor) Init(info *relaycommon.RelayInfo) {
	a.baseURL = info.ChannelBaseUrl
	a.apiKey = info.ApiKey
	a.model = strings.TrimSpace(info.OriginModelName)
}

// ValidateRequestAndSetAction parses the submit body. Unlike most task models,
// MediaKit enhance has NO prompt (input is a video_url), so we cannot use
// relaycommon.ValidateBasicTaskRequest (which requires a prompt). We validate
// that a video_url is resolvable and stash the request on the context.
func (a *TaskAdaptor) ValidateRequestAndSetAction(c *gin.Context, info *relaycommon.RelayInfo) *dto.TaskError {
	var req relaycommon.TaskSubmitReq
	if err := common.UnmarshalBodyReusable(c, &req); err != nil {
		return service.TaskErrorWrapperLocal(err, "invalid_request", http.StatusBadRequest)
	}
	if _, err := BuildToolPayload(&req, a.model); err != nil {
		return service.TaskErrorWrapperLocal(err, "invalid_request", http.StatusBadRequest)
	}
	info.Action = constant.TaskActionGenerate
	c.Set("task_request", req)
	return nil
}

// EstimateBilling returns the per-call factor over the base ModelPrice so the
// deducted quota equals the backend's VOLC_ENHANCE_VIDEO_PRICING charge.
func (a *TaskAdaptor) EstimateBilling(c *gin.Context, info *relaycommon.RelayInfo) map[string]float64 {
	// Subtitle erasure and matting are duration-priced through the model's
	// persisted pricing_config. The relay's generic video-spec calculation
	// applies that rate after this hook; never apply the enhancement matrix to
	// an unrelated MediaKit tool.
	if a.model != EnhanceModel {
		return nil
	}
	req, err := relaycommon.GetTaskRequest(c)
	if err != nil {
		return nil
	}
	resolution := firstNonEmpty(metaString(&req, "resolution"), strings.TrimSpace(req.Resolution))
	ratio := EnhanceRatio(
		metaString(&req, "tool_version", "toolVersion"),
		resolution,
		metaInt(&req, "resolution_limit", "resolutionLimit"),
		metaInt(&req, "fps"),
	)
	if ratio <= 0 {
		return nil
	}
	return map[string]float64{"volc_enhance": ratio}
}

func (a *TaskAdaptor) BuildRequestURL(info *relaycommon.RelayInfo) (string, error) {
	path, ok := toolPathForModel(a.model)
	if !ok {
		return "", fmt.Errorf("volc-mediakit: unsupported model %q", a.model)
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
	req, err := relaycommon.GetTaskRequest(c)
	if err != nil {
		return nil, err
	}
	payload, err := BuildToolPayload(&req, a.model)
	if err != nil {
		return nil, errors.Wrap(err, "build payload failed")
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
	if !sResp.Success || strings.TrimSpace(sResp.TaskID) == "" {
		msg := sResp.ErrorMessage()
		if msg == "" {
			msg = fmt.Sprintf("volc-mediakit submit failed: %s", responseBody)
		}
		taskErr = service.TaskErrorWrapper(fmt.Errorf("%s", msg), "submit_failed", http.StatusInternalServerError)
		return
	}

	ov := dto.NewOpenAIVideo()
	ov.ID = info.PublicTaskID
	ov.TaskID = info.PublicTaskID
	ov.CreatedAt = time.Now().Unix()
	ov.Model = info.OriginModelName
	c.JSON(http.StatusOK, ov)

	return strings.TrimSpace(sResp.TaskID), responseBody, nil
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

func (a *TaskAdaptor) GetModelList() []string {
	return []string{EnhanceModel, SubtitleModel, SubtitleProModel, MattingModel}
}

func (a *TaskAdaptor) GetChannelName() string { return ChannelName }

func (a *TaskAdaptor) ParseTaskResult(respBody []byte) (*relaycommon.TaskInfo, error) {
	var d DetailResponse
	if err := common.Unmarshal(respBody, &d); err != nil {
		return nil, errors.Wrap(err, "unmarshal task result failed")
	}

	info := &relaycommon.TaskInfo{}
	switch strings.ToLower(strings.TrimSpace(d.Status)) {
	case StatusCompleted:
		info.Status = model.TaskStatusSuccess
		info.Progress = taskcommon.ProgressComplete
		info.Url = d.VideoURL()
	case StatusFailed:
		info.Status = model.TaskStatusFailure
		info.Progress = taskcommon.ProgressComplete
		info.Reason = d.FailureReason()
	case StatusSubmitted, StatusQueued, "":
		info.Status = model.TaskStatusQueued
		info.Progress = taskcommon.ProgressQueued
	default: // running / processing / anything in-flight
		info.Status = model.TaskStatusInProgress
		info.Progress = taskcommon.ProgressInProgress
	}

	// Defensive: some responses report a result URL without a terminal status.
	if info.Status != model.TaskStatusFailure && info.Url == "" {
		if url := d.VideoURL(); url != "" {
			info.Status = model.TaskStatusSuccess
			info.Progress = taskcommon.ProgressComplete
			info.Url = url
		}
	}
	return info, nil
}

// ConvertToOpenAIVideo implements channel.OpenAIVideoConverter so new-api's
// OpenAI Sora-style GET /v1/videos/{task_id} endpoint can surface MediaKit task
// state to SDK clients. originTask.Data holds the most recent poll body from
// GET /api/v1/tasks/{task_id}; we unpack it into dto.OpenAIVideo.
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
		var d DetailResponse
		if err := common.Unmarshal(originTask.Data, &d); err == nil {
			if url := d.VideoURL(); url != "" {
				openAIVideo.SetMetadata("url", url)
			}
			if d.Result != nil {
				if d.Result.Duration > 0 {
					openAIVideo.SetMetadata("duration", d.Result.Duration)
				}
				if d.Result.FPS > 0 {
					openAIVideo.SetMetadata("fps", d.Result.FPS)
				}
				if resolution := strings.TrimSpace(d.Result.Resolution); resolution != "" {
					openAIVideo.SetMetadata("resolution", resolution)
				}
				if toolVersion := strings.TrimSpace(d.Result.ToolVer); toolVersion != "" {
					openAIVideo.SetMetadata("tool_version", toolVersion)
				}
			}
			if taskType := strings.TrimSpace(d.TaskType); taskType != "" {
				openAIVideo.SetMetadata("task_type", taskType)
			}
			if reason := d.FailureReason(); reason != "" &&
				(originTask.Status == model.TaskStatusFailure || originTask.Status == model.TaskStatusUnknown) {
				openAIVideo.Error = &dto.OpenAIVideoError{Message: reason}
			}
		}
	}

	return common.Marshal(openAIVideo)
}
