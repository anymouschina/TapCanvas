package bach

import (
	"bytes"
	"fmt"
	"io"
	"math"
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
	"github.com/golang-jwt/jwt/v5"
	"github.com/pkg/errors"
)

const (
	jwtExpiryDuration = 30 * time.Minute
	jwtNotBeforeSkew  = 5 * time.Second
)

type createTaskResponse struct {
	Code      int    `json:"code"`
	Message   string `json:"message"`
	Timestamp int64  `json:"timestamp"`
	Data      struct {
		TaskID    string `json:"task_id"`
		Status    string `json:"status"`
		CreatedAt int64  `json:"created_at"`
	} `json:"data"`
}

type queryTaskResponse struct {
	Code      int    `json:"code"`
	Message   string `json:"message"`
	Timestamp int64  `json:"timestamp"`
	Data      struct {
		TaskID           string `json:"task_id"`
		Status           string `json:"status"`
		CreatedAt        int64  `json:"created_at"`
		StartedAt        int64  `json:"started_at"`
		EstimatedSeconds int    `json:"estimated_seconds"`
		CompletedAt      int64  `json:"completed_at"`
		VideoURL         string `json:"video_url"`
		Message          string `json:"message"`
		Usage            *struct {
			VideoOutput float64 `json:"video_output"`
		} `json:"usage"`
	} `json:"data"`
}

// TaskAdaptor implements the Bach 1.0 Pro / Bach 1.0 Pro Ads native video API
// (POST /video/v2 and GET /video/v2/{task_id} with HS256 JWT Bearer auth).
type TaskAdaptor struct {
	taskcommon.BaseBilling
	apiKey  string
	baseURL string
}

func (a *TaskAdaptor) Init(info *relaycommon.RelayInfo) {
	base := strings.TrimRight(strings.TrimSpace(info.ChannelBaseUrl), "/")
	if base == "" {
		base = defaultBaseURL
	}
	a.baseURL = base
	a.apiKey = strings.TrimSpace(info.ApiKey)
}

func (a *TaskAdaptor) ValidateRequestAndSetAction(c *gin.Context, info *relaycommon.RelayInfo) *dto.TaskError {
	storage, err := common.GetBodyStorage(c)
	if err != nil {
		return service.TaskErrorWrapperLocal(err, "invalid_request", http.StatusBadRequest)
	}
	body, err := storage.Bytes()
	if err != nil {
		return service.TaskErrorWrapperLocal(err, "invalid_request", http.StatusBadRequest)
	}
	payload, req, err := NormalizePayload(body)
	if err != nil {
		return service.TaskErrorWrapperLocal(err, "invalid_request", http.StatusBadRequest)
	}
	resolution, seconds := taskcommon.ResolveTaskVideoBillingSpec(&req)
	pricingModel := pricingModelName(info.PricingModelName, info.OriginModelName)
	if pricingModel == "" {
		pricingModel = payload.ModelName
	}
	if _, ok := model.VideoSpecPriceCNY(pricingModel, resolution, seconds); !ok {
		return service.TaskErrorWrapperLocal(
			fmt.Errorf("bach video specification price missing for %s (%s, %ds)", pricingModel, resolution, seconds),
			"video_price_missing",
			http.StatusBadRequest,
		)
	}
	c.Set("task_request", req)
	c.Set("bach_video_payload", payload)
	info.Action = constant.TaskActionGenerate
	return nil
}

// EstimateBilling pre-charges output duration (rounded up) plus any caller-measured
// reference video duration at the requested output resolution (1080p or 4k).
func (a *TaskAdaptor) EstimateBilling(c *gin.Context, info *relaycommon.RelayInfo) map[string]float64 {
	if info.PriceData.ModelPrice <= 0 {
		return nil
	}
	req, err := relaycommon.GetTaskRequest(c)
	if err != nil {
		return nil
	}
	resolution, seconds := taskcommon.ResolveTaskVideoBillingSpec(&req)
	pricingModel := pricingModelName(info.PricingModelName, info.OriginModelName)
	if pricingModel == "" {
		pricingModel = req.Model
	}
	price, ok := model.VideoSpecPriceCNY(pricingModel, resolution, seconds)
	if !ok || price <= 0 {
		return nil
	}
	return map[string]float64{"spec_price": price / info.PriceData.ModelPrice}
}

func (a *TaskAdaptor) BuildRequestURL(_ *relaycommon.RelayInfo) (string, error) {
	base := strings.TrimRight(strings.TrimSpace(a.baseURL), "/")
	if base == "" {
		base = defaultBaseURL
	}
	return base + "/video/v2", nil
}

func (a *TaskAdaptor) BuildRequestHeader(_ *gin.Context, req *http.Request, info *relaycommon.RelayInfo) error {
	key := strings.TrimSpace(info.ApiKey)
	if key == "" {
		key = a.apiKey
	}
	token, err := generateJWTToken(key, time.Now())
	if err != nil {
		return fmt.Errorf("failed to generate Bach JWT token: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json")
	req.Header.Set("Authorization", "Bearer "+token)
	return nil
}

func (a *TaskAdaptor) BuildRequestBody(c *gin.Context, info *relaycommon.RelayInfo) (io.Reader, error) {
	v, ok := c.Get("bach_video_payload")
	payload, valid := v.(videoRequest)
	if !ok || !valid {
		return nil, fmt.Errorf("normalized bach video payload missing")
	}
	if upstream := strings.TrimSpace(info.UpstreamModelName); upstream != "" {
		if canonical, supported := CanonicalModelName(upstream); supported {
			payload.ModelName = canonical
		} else {
			payload.ModelName = upstream
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
	defer resp.Body.Close()
	responseBody, err := io.ReadAll(resp.Body)
	if err != nil {
		return "", nil, service.TaskErrorWrapper(err, "read_response_body_failed", http.StatusInternalServerError)
	}

	var bResp createTaskResponse
	if err := common.Unmarshal(responseBody, &bResp); err != nil {
		return "", responseBody, service.TaskErrorWrapper(
			errors.Wrap(err, string(responseBody)),
			"unmarshal_response_failed",
			http.StatusBadGateway,
		)
	}
	if bResp.Code != 200 || strings.TrimSpace(bResp.Data.TaskID) == "" {
		msg := strings.TrimSpace(bResp.Message)
		if msg == "" {
			msg = fmt.Sprintf("bach create task failed (code=%d)", bResp.Code)
		}
		return "", responseBody, service.TaskErrorWrapperLocal(fmt.Errorf("%s", msg), "bach_task_failed", http.StatusBadRequest)
	}

	ov := dto.NewOpenAIVideo()
	ov.ID = info.PublicTaskID
	ov.TaskID = info.PublicTaskID
	ov.Model = info.OriginModelName
	if bResp.Data.CreatedAt > 0 {
		ov.CreatedAt = bResp.Data.CreatedAt
	} else {
		ov.CreatedAt = time.Now().Unix()
	}
	c.JSON(http.StatusOK, ov)
	return strings.TrimSpace(bResp.Data.TaskID), responseBody, nil
}

func (a *TaskAdaptor) FetchTask(baseUrl, key string, body map[string]any, proxy string) (*http.Response, error) {
	taskID, ok := body["task_id"].(string)
	if !ok || strings.TrimSpace(taskID) == "" {
		return nil, fmt.Errorf("invalid task_id")
	}
	base := strings.TrimRight(strings.TrimSpace(baseUrl), "/")
	if base == "" {
		base = defaultBaseURL
	}
	url := fmt.Sprintf("%s/video/v2/%s", base, strings.TrimSpace(taskID))

	req, err := http.NewRequest(http.MethodGet, url, nil)
	if err != nil {
		return nil, err
	}

	token, err := generateJWTToken(key, time.Now())
	if err != nil {
		return nil, fmt.Errorf("failed to generate Bach JWT token: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json")
	req.Header.Set("Authorization", "Bearer "+token)

	client, err := service.GetHttpClientWithProxy(proxy)
	if err != nil {
		return nil, fmt.Errorf("new proxy http client failed: %w", err)
	}
	return client.Do(req)
}

func (a *TaskAdaptor) ParseTaskResult(respBody []byte) (*relaycommon.TaskInfo, error) {
	var resp queryTaskResponse
	if err := common.Unmarshal(respBody, &resp); err != nil {
		return nil, errors.Wrap(err, "failed to unmarshal bach query response")
	}
	if resp.Code != 0 && resp.Code != 200 {
		msg := strings.TrimSpace(resp.Message)
		if msg == "" {
			msg = fmt.Sprintf("bach query failed (code=%d)", resp.Code)
		}
		return nil, fmt.Errorf("%s", msg)
	}

	info := &relaycommon.TaskInfo{
		TaskID: resp.Data.TaskID,
	}
	switch strings.ToUpper(strings.TrimSpace(resp.Data.Status)) {
	case "TASK_PENDING":
		info.Status = model.TaskStatusSubmitted
		info.Progress = taskcommon.ProgressSubmitted
	case "TASK_PROCESSING":
		info.Status = model.TaskStatusInProgress
		info.Progress = estimateProgress(resp.Data.StartedAt, resp.Data.EstimatedSeconds, time.Now().Unix())
	case "TASK_SUCCEEDED":
		info.Status = model.TaskStatusSuccess
		info.Progress = taskcommon.ProgressComplete
		info.Url = strings.TrimSpace(resp.Data.VideoURL)
		if resp.Data.Usage != nil && resp.Data.Usage.VideoOutput > 0 {
			info.OutputSeconds = int(math.Ceil(resp.Data.Usage.VideoOutput))
		}
	case "TASK_FAILED":
		info.Status = model.TaskStatusFailure
		reason := strings.TrimSpace(resp.Data.Message)
		if reason == "" {
			reason = strings.TrimSpace(resp.Message)
		}
		info.Reason = reason
	default:
		return nil, fmt.Errorf("unknown bach task status: %q", resp.Data.Status)
	}
	return info, nil
}

func (a *TaskAdaptor) ConvertToOpenAIVideo(originTask *model.Task) ([]byte, error) {
	var resp queryTaskResponse
	if len(originTask.Data) > 0 {
		if err := common.Unmarshal(originTask.Data, &resp); err != nil {
			return nil, errors.Wrap(err, "unmarshal bach task data failed")
		}
	}

	ov := dto.NewOpenAIVideo()
	ov.ID = originTask.TaskID
	ov.TaskID = originTask.TaskID
	if originTask.Properties.OriginModelName != "" {
		ov.Model = originTask.Properties.OriginModelName
	}
	ov.Status = originTask.Status.ToVideoStatus()
	ov.SetProgressStr(originTask.Progress)
	ov.CreatedAt = originTask.CreatedAt
	ov.CompletedAt = originTask.UpdatedAt

	if videoURL := strings.TrimSpace(resp.Data.VideoURL); videoURL != "" {
		ov.SetMetadata("url", videoURL)
	}
	if resp.Data.Usage != nil && resp.Data.Usage.VideoOutput > 0 {
		ov.SetMetadata("video_output_seconds", resp.Data.Usage.VideoOutput)
	}
	if originTask.Status == model.TaskStatusFailure || strings.EqualFold(resp.Data.Status, "TASK_FAILED") {
		msg := strings.TrimSpace(resp.Data.Message)
		if msg == "" {
			msg = strings.TrimSpace(originTask.FailReason)
		}
		if msg == "" {
			msg = "bach video generation failed"
		}
		ov.Error = &dto.OpenAIVideoError{
			Message: msg,
			Code:    "bach_task_failed",
		}
	}
	return common.Marshal(ov)
}

func (a *TaskAdaptor) GetModelList() []string { return ModelList }
func (a *TaskAdaptor) GetChannelName() string { return "Bach Video" }

func pricingModelName(preferred, fallback string) string {
	if strings.TrimSpace(preferred) != "" {
		return strings.TrimSpace(preferred)
	}
	return strings.TrimSpace(fallback)
}

// generateJWTToken builds a standard RFC 7519 HS256 JWT Bearer token from
// "access_key|secret_key" as documented in https://www.bach.art/api/docs/authentication.
func generateJWTToken(apiKey string, now time.Time) (string, error) {
	parts := strings.SplitN(strings.TrimSpace(apiKey), "|", 2)
	if len(parts) != 2 {
		return "", fmt.Errorf("invalid bach API key format: expected 'access_key|secret_key'")
	}
	ak := strings.TrimSpace(parts[0])
	sk := strings.TrimSpace(parts[1])
	if ak == "" || sk == "" {
		return "", fmt.Errorf("invalid bach API key: access_key and secret_key must be non-empty")
	}
	claims := jwt.MapClaims{
		"iss": ak,
		"nbf": now.Add(-jwtNotBeforeSkew).Unix(),
		"exp": now.Add(jwtExpiryDuration).Unix(),
	}
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	token.Header["alg"] = "HS256"
	token.Header["typ"] = "JWT"
	return token.SignedString([]byte(sk))
}

func estimateProgress(startedAt int64, estimatedSeconds int, nowUnix int64) string {
	if startedAt <= 0 || estimatedSeconds <= 0 || nowUnix <= startedAt {
		return taskcommon.ProgressInProgress
	}
	pct := int(float64(nowUnix-startedAt) / float64(estimatedSeconds) * 90.0)
	if pct < 15 {
		pct = 15
	}
	if pct > 95 {
		pct = 95
	}
	return fmt.Sprintf("%d%%", pct)
}
