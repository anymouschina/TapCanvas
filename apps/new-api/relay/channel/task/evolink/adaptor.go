package evolink

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
	taskapimart "github.com/QuantumNous/new-api/relay/channel/task/apimart"
	taskcommon "github.com/QuantumNous/new-api/relay/channel/task/taskcommon"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	"github.com/QuantumNous/new-api/service"

	"github.com/gin-gonic/gin"
	"github.com/pkg/errors"
)

// TaskAdaptor drives Evolink's async video flow (submit → poll). The submit body
// is built per model family in payload.go; the poll envelope is identical to
// APIMart's flat form, so SubmitResponse/DetailResponse parsing is reused from
// the APIMart task package. Billing mirrors APIMart: a flat per-call model price
// (BaseBilling returns no extra ratios), with the per-second/resolution detail
// living in model/pricing.go's linearVideoPricingRules for the /api/pricing
// snapshot.
type TaskAdaptor struct {
	taskcommon.BaseBilling
	apiKey  string
	baseURL string
}

func (a *TaskAdaptor) Init(info *relaycommon.RelayInfo) {
	a.baseURL = info.ChannelBaseUrl
	a.apiKey = info.ApiKey
}

func (a *TaskAdaptor) ValidateRequestAndSetAction(c *gin.Context, info *relaycommon.RelayInfo) *dto.TaskError {
	return relaycommon.ValidateBasicTaskRequest(c, info, constant.TaskActionGenerate)
}

func (a *TaskAdaptor) BuildRequestURL(info *relaycommon.RelayInfo) (string, error) {
	return a.baseURL + submitPathVideos, nil
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

	// Upstream model string is the billable model (OriginModelName may be an alias).
	req.Model = info.UpstreamModelName

	payload, err := BuildSubmitPayload(&req)
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

	var sResp taskapimart.SubmitResponse
	if err := common.Unmarshal(responseBody, &sResp); err != nil {
		taskErr = service.TaskErrorWrapper(errors.Wrapf(err, "body: %s", responseBody),
			"unmarshal_response_body_failed", http.StatusInternalServerError)
		return
	}
	upstreamTaskID := sResp.TaskID()
	if !sResp.Accepted() || upstreamTaskID == "" {
		msg := sResp.ErrorMessage()
		if msg == "" {
			msg = fmt.Sprintf("evolink submit not accepted: %s", string(responseBody))
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

	return upstreamTaskID, responseBody, nil
}

func (a *TaskAdaptor) FetchTask(baseUrl, key string, body map[string]any, proxy string) (*http.Response, error) {
	taskID, ok := body["task_id"].(string)
	if !ok || taskID == "" {
		return nil, fmt.Errorf("invalid task_id")
	}
	uri := baseUrl + taskapimart.PollPath(taskID) // /v1/tasks/{id}
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

func (a *TaskAdaptor) GetModelList() []string { return ModelList }

func (a *TaskAdaptor) GetChannelName() string { return ChannelName }

func (a *TaskAdaptor) ParseTaskResult(respBody []byte) (*relaycommon.TaskInfo, error) {
	var dResp taskapimart.DetailResponse
	if err := common.Unmarshal(respBody, &dResp); err != nil {
		return nil, errors.Wrap(err, "unmarshal task result failed")
	}

	info := &relaycommon.TaskInfo{Code: dResp.Code}
	if !dResp.Ready() {
		// Error envelope (or not-yet-parseable). Treat a clear failure reason as
		// failure; otherwise keep polling.
		if reason := dResp.FailureReason(); reason != "" {
			info.Status = model.TaskStatusFailure
			info.Reason = reason
			info.Progress = taskcommon.ProgressComplete
			return info, nil
		}
		info.Status = model.TaskStatusInProgress
		info.Progress = taskcommon.ProgressInProgress
		return info, nil
	}

	info.Progress = clampProgress(dResp.EffectiveProgress())
	switch dResp.EffectiveStatus() {
	case taskapimart.StatusPending, taskapimart.StatusQueued:
		info.Status = model.TaskStatusQueued
	case taskapimart.StatusProcessing, taskapimart.StatusInProgress:
		info.Status = model.TaskStatusInProgress
	case taskapimart.StatusCompleted:
		info.Status = model.TaskStatusSuccess
		info.Progress = taskcommon.ProgressComplete
		info.Url = firstResultURL(&dResp, respBody)
	case taskapimart.StatusFailed:
		info.Status = model.TaskStatusFailure
		info.Progress = taskcommon.ProgressComplete
		info.Reason = dResp.FailureReason()
	case taskapimart.StatusCancelled:
		info.Status = model.TaskStatusFailure
		info.Progress = taskcommon.ProgressComplete
		info.Reason = "cancelled"
	default:
		info.Status = model.TaskStatusInProgress
	}
	return info, nil
}

// ConvertToOpenAIVideo surfaces Evolink task state to new-api's
// GET /v1/videos/{task_id} (OpenAI Sora-style) endpoint.
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
		var dResp taskapimart.DetailResponse
		if err := common.Unmarshal(originTask.Data, &dResp); err == nil {
			if url := firstResultURL(&dResp, originTask.Data); url != "" {
				openAIVideo.SetMetadata("url", url)
			}
			if reason := dResp.FailureReason(); reason != "" &&
				(originTask.Status == model.TaskStatusFailure || originTask.Status == model.TaskStatusUnknown) {
				openAIVideo.Error = &dto.OpenAIVideoError{Message: reason}
			}
		}
	}
	return common.Marshal(openAIVideo)
}

// firstResultURL prefers the struct parser's URL, then falls back to a recursive
// scan that survives result-shape differences.
func firstResultURL(dResp *taskapimart.DetailResponse, respBody []byte) string {
	if u := dResp.FirstURL(); u != "" {
		return u
	}
	if urls := collectResultURLs(respBody); len(urls) > 0 {
		return urls[0]
	}
	return ""
}

func clampProgress(pct int) string {
	if pct <= 0 {
		return taskcommon.ProgressQueued
	}
	if pct >= 100 {
		return taskcommon.ProgressComplete
	}
	return fmt.Sprintf("%d%%", pct)
}

// collectResultURLs recursively gathers http(s) result URLs (video/image) from a
// poll body — a schema-agnostic fallback for result shapes the struct parser
// doesn't model.
func collectResultURLs(body []byte) []string {
	var root any
	if err := common.Unmarshal(body, &root); err != nil {
		return nil
	}
	seen := make(map[string]struct{})
	var out []string
	var walk func(n any, keyHint string)
	walk = func(n any, keyHint string) {
		switch t := n.(type) {
		case map[string]any:
			for k, v := range t {
				walk(v, strings.ToLower(k))
			}
		case []any:
			for _, v := range t {
				walk(v, keyHint)
			}
		case string:
			s := strings.TrimSpace(t)
			if !isHTTPURL(s) {
				return
			}
			if !looksLikeMediaURL(s) && !isURLKey(keyHint) {
				return
			}
			if _, dup := seen[s]; dup {
				return
			}
			seen[s] = struct{}{}
			out = append(out, s)
		}
	}
	walk(root, "")
	return out
}

func isHTTPURL(s string) bool {
	return strings.HasPrefix(s, "http://") || strings.HasPrefix(s, "https://")
}

func looksLikeMediaURL(s string) bool {
	lower := strings.ToLower(s)
	if i := strings.IndexAny(lower, "?#"); i >= 0 {
		lower = lower[:i]
	}
	for _, ext := range []string{".mp4", ".mov", ".webm", ".m4v", ".png", ".jpg", ".jpeg", ".webp"} {
		if strings.HasSuffix(lower, ext) {
			return true
		}
	}
	return false
}

func isURLKey(key string) bool {
	if key == "" {
		return false
	}
	for _, frag := range []string{"url", "video", "output", "result", "file", "mp4", "cover", "thumbnail"} {
		if strings.Contains(key, frag) {
			return true
		}
	}
	return false
}
