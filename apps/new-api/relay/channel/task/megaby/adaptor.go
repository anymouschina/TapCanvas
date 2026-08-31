package megaby

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
	taskcommon "github.com/QuantumNous/new-api/relay/channel/task/taskcommon"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	"github.com/QuantumNous/new-api/service"

	"github.com/gin-gonic/gin"
	"github.com/pkg/errors"
)

type TaskAdaptor struct {
	taskcommon.BaseBilling
	apiKey  string
	baseURL string
}

const billingSpecPriceContextKey = "megaby_billing_spec_price_cny"

type videoResponse struct {
	ID          string         `json:"id,omitempty"`
	TaskID      string         `json:"task_id,omitempty"`
	Status      string         `json:"status,omitempty"`
	Model       string         `json:"model,omitempty"`
	Progress    int            `json:"progress,omitempty"`
	URL         string         `json:"url,omitempty"`
	VideoURL    string         `json:"video_url,omitempty"`
	Metadata    responseMeta   `json:"metadata,omitempty"`
	Error       *responseError `json:"error,omitempty"`
	Message     string         `json:"message,omitempty"`
	CreatedAt   int64          `json:"created_at,omitempty"`
	CompletedAt int64          `json:"completed_at,omitempty"`
}

type responseMeta struct {
	ContentURL string `json:"content_url,omitempty"`
	LocalURL   string `json:"local_url,omitempty"`
	URL        string `json:"url,omitempty"`
}

type responseError struct {
	Code    string `json:"code,omitempty"`
	Message string `json:"message,omitempty"`
	Type    string `json:"type,omitempty"`
}

func (a *TaskAdaptor) Init(info *relaycommon.RelayInfo) {
	a.baseURL = strings.TrimRight(info.ChannelBaseUrl, "/")
	a.apiKey = info.ApiKey
}

func (a *TaskAdaptor) ValidateRequestAndSetAction(c *gin.Context, info *relaycommon.RelayInfo) *dto.TaskError {
	if taskErr := relaycommon.ValidateBasicTaskRequest(c, info, constant.TaskActionGenerate); taskErr != nil {
		return taskErr
	}
	req, err := relaycommon.GetTaskRequest(c)
	if err != nil {
		return service.TaskErrorWrapperLocal(err, "invalid_request", http.StatusBadRequest)
	}
	normalized, err := normalizeRequestForBilling(req)
	if err != nil {
		return service.TaskErrorWrapperLocal(err, "invalid_request", http.StatusBadRequest)
	}
	billingResolution, billingDuration, err := resolveBillingSpec(&normalized)
	if err != nil {
		return service.TaskErrorWrapperLocal(err, "invalid_billing_spec", http.StatusBadRequest)
	}
	billingPrice, configured := model.VideoSpecPriceCNY(normalized.Model, billingResolution, billingDuration)
	if !configured || billingPrice <= 0 {
		return service.TaskErrorWrapperLocal(
			fmt.Errorf("megaby %s: billing price is not configured for %s/%ds", normalized.Model, billingResolution, billingDuration),
			"billing_price_not_configured",
			http.StatusBadRequest,
		)
	}
	c.Set(billingSpecPriceContextKey, billingPrice)
	relaycommon.SetTaskRequest(c, normalized)
	return nil
}

func (a *TaskAdaptor) EstimateBilling(c *gin.Context, info *relaycommon.RelayInfo) map[string]float64 {
	value, exists := c.Get(billingSpecPriceContextKey)
	billingPrice, validPrice := value.(float64)
	if !exists || !validPrice || billingPrice <= 0 || info.PriceData.ModelPrice <= 0 {
		return nil
	}
	return map[string]float64{"spec_price": billingPrice / info.PriceData.ModelPrice}
}

func (a *TaskAdaptor) BuildRequestURL(_ *relaycommon.RelayInfo) (string, error) {
	return a.baseURL + submitPath, nil
}

func (a *TaskAdaptor) BuildRequestHeader(_ *gin.Context, req *http.Request, _ *relaycommon.RelayInfo) error {
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
	req.Model = info.UpstreamModelName
	payload, err := BuildSubmitPayload(&req)
	if err != nil {
		return nil, errors.Wrap(err, "build Megaby payload failed")
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

func (a *TaskAdaptor) DoResponse(c *gin.Context, resp *http.Response, info *relaycommon.RelayInfo) (string, []byte, *dto.TaskError) {
	responseBody, err := io.ReadAll(resp.Body)
	if err != nil {
		return "", nil, service.TaskErrorWrapper(err, "read_response_body_failed", http.StatusInternalServerError)
	}
	_ = resp.Body.Close()

	var submitted videoResponse
	if err := common.Unmarshal(responseBody, &submitted); err != nil {
		return "", nil, service.TaskErrorWrapper(errors.Wrapf(err, "body: %s", responseBody), "unmarshal_response_body_failed", http.StatusInternalServerError)
	}
	taskID := submitted.upstreamTaskID()
	if resp.StatusCode < http.StatusOK || resp.StatusCode >= http.StatusMultipleChoices || taskID == "" {
		message := submitted.errorMessage()
		if message == "" {
			message = fmt.Sprintf("Megaby submit failed with HTTP %d", resp.StatusCode)
		}
		code := "megaby_submit_failed"
		if submitted.Error != nil && strings.TrimSpace(submitted.Error.Code) != "" {
			code = strings.TrimSpace(submitted.Error.Code)
		}
		return "", nil, service.TaskErrorWrapper(errors.New(message), code, resp.StatusCode)
	}

	result := dto.NewOpenAIVideo()
	result.ID = info.PublicTaskID
	result.TaskID = info.PublicTaskID
	result.CreatedAt = time.Now().Unix()
	result.Model = info.OriginModelName
	c.JSON(http.StatusOK, result)
	return taskID, responseBody, nil
}

func (a *TaskAdaptor) FetchTask(baseURL, key string, body map[string]any, proxy string) (*http.Response, error) {
	taskID, ok := body["task_id"].(string)
	if !ok || strings.TrimSpace(taskID) == "" {
		return nil, fmt.Errorf("invalid task_id")
	}
	request, err := http.NewRequest(http.MethodGet, strings.TrimRight(baseURL, "/")+submitPath+"/"+taskID, nil)
	if err != nil {
		return nil, err
	}
	request.Header.Set("Accept", "application/json")
	request.Header.Set("Authorization", "Bearer "+key)
	client, err := service.GetHttpClientWithProxy(proxy)
	if err != nil {
		return nil, fmt.Errorf("new proxy http client failed: %w", err)
	}
	return client.Do(request)
}

func (a *TaskAdaptor) GetModelList() []string { return ModelList }

func (a *TaskAdaptor) GetChannelName() string { return ChannelName }

func (a *TaskAdaptor) ParseTaskResult(respBody []byte) (*relaycommon.TaskInfo, error) {
	var response videoResponse
	if err := common.Unmarshal(respBody, &response); err != nil {
		return nil, errors.Wrap(err, "unmarshal Megaby task result failed")
	}
	info := &relaycommon.TaskInfo{Progress: progressString(response.Progress)}
	switch strings.ToLower(strings.TrimSpace(response.Status)) {
	case "queued", "pending":
		info.Status = model.TaskStatusQueued
	case "processing", "in_progress", "running":
		info.Status = model.TaskStatusInProgress
	case "completed", "succeeded", "success":
		info.Status = model.TaskStatusSuccess
		info.Progress = taskcommon.ProgressComplete
		info.Url = response.resultURL()
		if info.Url == "" {
			return nil, fmt.Errorf("Megaby task %q completed without a video URL", response.upstreamTaskID())
		}
	case "failed", "cancelled", "canceled":
		info.Status = model.TaskStatusFailure
		info.Progress = taskcommon.ProgressComplete
		info.Reason = response.errorMessage()
		if info.Reason == "" {
			info.Reason = response.Status
		}
	default:
		if response.errorMessage() != "" {
			info.Status = model.TaskStatusFailure
			info.Progress = taskcommon.ProgressComplete
			info.Reason = response.errorMessage()
		} else {
			return nil, fmt.Errorf("Megaby task %q returned unknown status %q", response.upstreamTaskID(), response.Status)
		}
	}
	return info, nil
}

func (a *TaskAdaptor) ConvertToOpenAIVideo(originTask *model.Task) ([]byte, error) {
	result := dto.NewOpenAIVideo()
	result.ID = originTask.TaskID
	result.TaskID = originTask.TaskID
	result.Status = originTask.Status.ToVideoStatus()
	result.SetProgressStr(originTask.Progress)
	result.CreatedAt = originTask.CreatedAt
	result.CompletedAt = originTask.UpdatedAt
	result.Model = originTask.Properties.OriginModelName
	if len(originTask.Data) > 0 {
		var response videoResponse
		if err := common.Unmarshal(originTask.Data, &response); err == nil {
			if videoURL := response.resultURL(); videoURL != "" {
				result.SetMetadata("url", videoURL)
			}
			if response.Error != nil && originTask.Status == model.TaskStatusFailure {
				result.Error = &dto.OpenAIVideoError{
					Message: response.errorMessage(),
					Code:    strings.TrimSpace(response.Error.Code),
				}
			}
		}
	}
	return common.Marshal(result)
}

func (response *videoResponse) upstreamTaskID() string {
	if response == nil {
		return ""
	}
	if taskID := strings.TrimSpace(response.TaskID); taskID != "" {
		return taskID
	}
	return strings.TrimSpace(response.ID)
}

func (response *videoResponse) resultURL() string {
	if response == nil {
		return ""
	}
	for _, candidate := range []string{
		response.VideoURL,
		response.URL,
		response.Metadata.ContentURL,
		response.Metadata.LocalURL,
		response.Metadata.URL,
	} {
		if value := strings.TrimSpace(candidate); value != "" {
			return value
		}
	}
	return ""
}

func (response *videoResponse) errorMessage() string {
	if response == nil {
		return ""
	}
	if response.Error != nil && strings.TrimSpace(response.Error.Message) != "" {
		return strings.TrimSpace(response.Error.Message)
	}
	return strings.TrimSpace(response.Message)
}

func progressString(progress int) string {
	if progress <= 0 {
		return taskcommon.ProgressQueued
	}
	if progress >= 100 {
		return taskcommon.ProgressComplete
	}
	return fmt.Sprintf("%d%%", progress)
}
