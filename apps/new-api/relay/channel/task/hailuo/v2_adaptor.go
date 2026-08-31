package hailuo

import (
	"bytes"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strconv"
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
)

type V2TaskAdaptor struct {
	taskcommon.BaseBilling
	apiKey  string
	baseURL string
}

type V2SubmitResponse struct {
	TaskID string `json:"task_id"`
}

type V2QueryResponse struct {
	Task  *V2Task     `json:"task,omitempty"`
	Error *V2APIError `json:"error,omitempty"`
}

type V2APIError struct {
	Type     string `json:"type,omitempty"`
	Message  string `json:"message,omitempty"`
	HTTPCode string `json:"http_code,omitempty"`
	Code     string `json:"code,omitempty"`
}

type V2Task struct {
	ID         string        `json:"id"`
	Model      string        `json:"model"`
	Status     string        `json:"status"`
	Error      *V2APIError   `json:"error,omitempty"`
	CreatedAt  int64         `json:"created_at,omitempty"`
	UpdatedAt  int64         `json:"updated_at,omitempty"`
	Content    V2TaskContent `json:"content,omitempty"`
	Resolution string        `json:"resolution,omitempty"`
	Duration   int           `json:"duration,omitempty"`
	Usage      V2TaskUsage   `json:"usage,omitempty"`
	Ratio      string        `json:"ratio,omitempty"`
	TaskType   string        `json:"task_type,omitempty"`
	Modality   string        `json:"modality,omitempty"`
}

type V2TaskContent struct {
	URL string `json:"url,omitempty"`
}

type V2TaskUsage struct {
	TotalSeconds      int `json:"total_seconds,omitempty"`
	InputSeconds      int `json:"input_seconds,omitempty"`
	OutputSeconds     int `json:"output_seconds,omitempty"`
	InputImageCount   int `json:"input_image_count,omitempty"`
	InputAudioSeconds int `json:"input_audio_seconds,omitempty"`
	TotalTokens       int `json:"total_tokens,omitempty"`
	PromptTokens      int `json:"prompt_tokens,omitempty"`
	CompletionTokens  int `json:"completion_tokens,omitempty"`
}

func (a *V2TaskAdaptor) Init(info *relaycommon.RelayInfo) {
	a.baseURL = strings.TrimRight(info.ChannelBaseUrl, "/")
	a.apiKey = info.ApiKey
}

func (a *V2TaskAdaptor) ValidateRequestAndSetAction(c *gin.Context, info *relaycommon.RelayInfo) *dto.TaskError {
	if taskErr := relaycommon.ValidateBasicTaskRequest(c, info, constant.TaskActionTextGenerate); taskErr != nil {
		return taskErr
	}
	req, err := relaycommon.GetTaskRequest(c)
	if err != nil {
		return newV2TaskError(err, "invalid_request", http.StatusBadRequest)
	}
	payload, mode, err := buildV2VideoRequest(&req, req.Model)
	if err != nil {
		return newV2TaskError(err, "invalid_request", http.StatusBadRequest)
	}
	switch mode {
	case v2ModeText:
		info.Action = constant.TaskActionTextGenerate
	case v2ModeFrame:
		if hasV2Role(payload.Content, "first_frame") && hasV2Role(payload.Content, "last_frame") {
			info.Action = constant.TaskActionFirstTailGenerate
		} else {
			info.Action = constant.TaskActionGenerate
		}
	case v2ModeReference:
		info.Action = constant.TaskActionReferenceGenerate
	}
	return nil
}

func (a *V2TaskAdaptor) EstimateBilling(c *gin.Context, info *relaycommon.RelayInfo) map[string]float64 {
	if info.PriceData.ModelPrice <= 0 {
		return nil
	}
	req, err := relaycommon.GetTaskRequest(c)
	if err != nil {
		return nil
	}
	payload, _, err := buildV2VideoRequest(&req, info.UpstreamModelName)
	if err != nil {
		return nil
	}
	_, billableDuration := taskcommon.ResolveTaskVideoBillingSpec(&req)
	if billableDuration < payload.Duration {
		billableDuration = payload.Duration
	}
	pricingResolution, err := v2PublicPricingResolution(payload.Resolution)
	if err != nil {
		return nil
	}
	price, ok := model.VideoSpecPriceCNY(info.OriginModelName, pricingResolution, billableDuration)
	if !ok {
		return nil
	}
	price += v2ReferenceImageSurchargeCNY(info.OriginModelName, countV2InputImages(payload.Content))
	return map[string]float64{"spec_price": price / info.PriceData.ModelPrice}
}

func (a *V2TaskAdaptor) AdjustBillingOnComplete(task *model.Task, taskResult *relaycommon.TaskInfo) int {
	if task == nil || taskResult == nil || taskResult.Status != model.TaskStatusSuccess {
		return 0
	}
	context := task.PrivateData.BillingContext
	if context == nil || context.GroupRatio <= 0 {
		return 0
	}
	seconds := taskResult.InputSeconds + taskResult.OutputSeconds
	if seconds <= 0 || strings.TrimSpace(taskResult.Resolution) == "" {
		return 0
	}
	pricingResolution, err := v2PublicPricingResolution(taskResult.Resolution)
	if err != nil {
		return 0
	}
	price, ok := model.VideoSpecPriceCNY(context.OriginModelName, pricingResolution, seconds)
	if !ok {
		return 0
	}
	price += v2ReferenceImageSurchargeCNY(context.OriginModelName, taskResult.InputImageCount)
	if channelPriceRatio := context.OtherRatios["channel_price"]; channelPriceRatio > 0 {
		price *= channelPriceRatio
	}
	userPriceRatio := common.NormalizePriceRatio(context.UserPriceRatio)
	return int(price * common.QuotaPerUnit * context.GroupRatio * userPriceRatio)
}

func v2ReferenceImageSurchargeCNY(modelName string, inputImageCount int) float64 {
	chargeableCount := inputImageCount - model.EffectiveImageReferenceFreeCount(modelName)
	if chargeableCount <= 0 {
		return 0
	}
	return float64(chargeableCount) * model.EffectiveImageReferencePriceCNY(modelName)
}

func (a *V2TaskAdaptor) BuildRequestURL(_ *relaycommon.RelayInfo) (string, error) {
	if a.baseURL == "" {
		return "", fmt.Errorf("minimax v2 base URL is empty")
	}
	return a.baseURL + V2GenerateEndpoint, nil
}

func (a *V2TaskAdaptor) BuildRequestHeader(_ *gin.Context, req *http.Request, _ *relaycommon.RelayInfo) error {
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json")
	req.Header.Set("Authorization", "Bearer "+a.apiKey)
	return nil
}

func (a *V2TaskAdaptor) BuildRequestBody(c *gin.Context, info *relaycommon.RelayInfo) (io.Reader, error) {
	req, err := relaycommon.GetTaskRequest(c)
	if err != nil {
		return nil, err
	}
	payload, _, err := buildV2VideoRequest(&req, info.UpstreamModelName)
	if err != nil {
		return nil, err
	}
	data, err := common.Marshal(payload)
	if err != nil {
		return nil, err
	}
	return bytes.NewReader(data), nil
}

func (a *V2TaskAdaptor) DoRequest(c *gin.Context, info *relaycommon.RelayInfo, requestBody io.Reader) (*http.Response, error) {
	return channel.DoTaskApiRequest(a, c, info, requestBody)
}

func (a *V2TaskAdaptor) DoResponse(c *gin.Context, resp *http.Response, info *relaycommon.RelayInfo) (taskID string, taskData []byte, taskErr *dto.TaskError) {
	responseBody, err := io.ReadAll(resp.Body)
	if err != nil {
		return "", nil, service.TaskErrorWrapper(err, "read_response_body_failed", http.StatusInternalServerError)
	}
	_ = resp.Body.Close()
	var submitResponse V2SubmitResponse
	if err := common.Unmarshal(responseBody, &submitResponse); err != nil {
		return "", responseBody, service.TaskErrorWrapper(fmt.Errorf("decode minimax v2 submit response: %w", err), "unmarshal_response_body_failed", http.StatusInternalServerError)
	}
	if strings.TrimSpace(submitResponse.TaskID) == "" {
		return "", responseBody, service.TaskErrorWrapper(fmt.Errorf("minimax v2 submit response is missing task_id"), "invalid_response", http.StatusBadGateway)
	}

	openAIVideo := dto.NewOpenAIVideo()
	openAIVideo.ID = info.PublicTaskID
	openAIVideo.TaskID = info.PublicTaskID
	openAIVideo.CreatedAt = time.Now().Unix()
	openAIVideo.Model = info.OriginModelName
	c.JSON(http.StatusOK, openAIVideo)
	return submitResponse.TaskID, responseBody, nil
}

func (a *V2TaskAdaptor) FetchTask(baseURL, key string, body map[string]any, proxy string) (*http.Response, error) {
	taskID, ok := body["task_id"].(string)
	if !ok || strings.TrimSpace(taskID) == "" {
		return nil, fmt.Errorf("invalid task_id")
	}
	requestURL := strings.TrimRight(baseURL, "/") + V2QueryEndpointPrefix + url.PathEscape(taskID)
	req, err := http.NewRequest(http.MethodGet, requestURL, nil)
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

func (a *V2TaskAdaptor) ParseTaskResult(respBody []byte) (*relaycommon.TaskInfo, error) {
	var response V2QueryResponse
	if err := common.Unmarshal(respBody, &response); err != nil {
		return nil, fmt.Errorf("decode minimax v2 task response: %w", err)
	}
	if response.Task == nil {
		if response.Error != nil {
			return nil, fmt.Errorf("minimax v2 query error %s: %s", firstNonEmpty(response.Error.Code, response.Error.HTTPCode, response.Error.Type), response.Error.Message)
		}
		return nil, fmt.Errorf("minimax v2 query response is missing task")
	}
	task := response.Task
	result := &relaycommon.TaskInfo{
		Code:             0,
		TaskID:           task.ID,
		InputSeconds:     task.Usage.InputSeconds,
		OutputSeconds:    task.Usage.OutputSeconds,
		InputImageCount:  task.Usage.InputImageCount,
		Resolution:       task.Resolution,
		TotalTokens:      task.Usage.TotalTokens,
		CompletionTokens: task.Usage.CompletionTokens,
	}
	switch task.Status {
	case "queued":
		result.Status = model.TaskStatusQueued
		result.Progress = taskcommon.ProgressQueued
	case "running":
		result.Status = model.TaskStatusInProgress
		result.Progress = "50%"
	case "succeeded":
		if strings.TrimSpace(task.Content.URL) == "" {
			return nil, fmt.Errorf("minimax v2 succeeded task %s is missing content.url", task.ID)
		}
		result.Status = model.TaskStatusSuccess
		result.Progress = taskcommon.ProgressComplete
		result.Url = task.Content.URL
	case "failed", "cancelled":
		result.Status = model.TaskStatusFailure
		result.Progress = taskcommon.ProgressComplete
		if task.Error != nil {
			result.Code, _ = strconv.Atoi(task.Error.Code)
			result.Reason = task.Error.Message
		}
		if result.Reason == "" {
			result.Reason = "minimax v2 task " + task.Status
		}
	default:
		return nil, fmt.Errorf("minimax v2 task %s returned unknown status %q", task.ID, task.Status)
	}
	return result, nil
}

func (a *V2TaskAdaptor) ConvertToOpenAIVideo(originTask *model.Task) ([]byte, error) {
	var response V2QueryResponse
	if err := common.Unmarshal(originTask.Data, &response); err != nil {
		return nil, fmt.Errorf("decode minimax v2 task data: %w", err)
	}
	openAIVideo := originTask.ToOpenAIVideo()
	if response.Task != nil && response.Task.Error != nil {
		openAIVideo.Error = &dto.OpenAIVideoError{
			Message: response.Task.Error.Message,
			Code:    response.Task.Error.Code,
		}
	}
	return common.Marshal(openAIVideo)
}

func (a *V2TaskAdaptor) GetModelList() []string {
	return V2ModelList
}

func (a *V2TaskAdaptor) GetChannelName() string {
	return "hailuo-video-v2"
}

func newV2TaskError(err error, code string, statusCode int) *dto.TaskError {
	return &dto.TaskError{
		Code:       code,
		Message:    err.Error(),
		StatusCode: statusCode,
		LocalError: true,
		Error:      err,
	}
}
