package agnes

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"errors"
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
	taskcommon "github.com/QuantumNous/new-api/relay/channel/task/taskcommon"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	"github.com/QuantumNous/new-api/service"
	"github.com/gin-gonic/gin"
)

const (
	ChannelName       = "agnes"
	ModelVideo25      = "agnes-video-2.5"
	ModelVideo25Flash = "agnes-video-2.5-flash"

	submitPath = "/v1/videos"
	fetchPath  = "/agnesapi"
)

var (
	ModelList   = []string{ModelVideo25, ModelVideo25Flash}
	validRatios = map[string]struct{}{
		"21:9": {}, "16:9": {}, "4:3": {}, "1:1": {}, "3:4": {}, "9:16": {},
	}
)

type TaskAdaptor struct {
	taskcommon.BaseBilling
	apiKey  string
	baseURL string
}

type submitPayload struct {
	Model       string                           `json:"model"`
	Prompt      string                           `json:"prompt"`
	Mode        string                           `json:"mode"`
	Seconds     string                           `json:"seconds"`
	Size        string                           `json:"size"`
	AspectRatio string                           `json:"aspect_ratio"`
	Seed        *int                             `json:"seed,omitempty"`
	N           *int                             `json:"n,omitempty"`
	FirstFrame  string                           `json:"first_frame,omitempty"`
	LastFrame   string                           `json:"last_frame,omitempty"`
	Images      []string                         `json:"images,omitempty"`
	Audios      []string                         `json:"audios,omitempty"`
	Videos      []relaycommon.TaskVideoReference `json:"videos,omitempty"`
}

type videoResponse struct {
	ID          string          `json:"id,omitempty"`
	TaskID      string          `json:"task_id,omitempty"`
	VideoID     string          `json:"video_id,omitempty"`
	URL         string          `json:"url,omitempty"`
	Object      string          `json:"object,omitempty"`
	Model       string          `json:"model,omitempty"`
	Status      string          `json:"status,omitempty"`
	Progress    int             `json:"progress,omitempty"`
	CreatedAt   int64           `json:"created_at,omitempty"`
	CompletedAt int64           `json:"completed_at,omitempty"`
	Seconds     string          `json:"seconds,omitempty"`
	Size        string          `json:"size,omitempty"`
	Metadata    *responseMeta   `json:"metadata,omitempty"`
	Error       *responseError  `json:"error,omitempty"`
	Message     string          `json:"message,omitempty"`
	Detail      json.RawMessage `json:"detail,omitempty"`
}

type responseMeta struct {
	URL string `json:"url,omitempty"`
}

type responseError struct {
	Code    string `json:"code,omitempty"`
	Message string `json:"message,omitempty"`
}

type pollIdentity struct {
	VideoID string `json:"video_id"`
	Model   string `json:"model"`
}

type normalizedRequest struct {
	request     relaycommon.TaskSubmitReq
	model       string
	mode        string
	resolution  string
	aspectRatio string
}

func (a *TaskAdaptor) Init(info *relaycommon.RelayInfo) {
	a.baseURL = agnesRoot(info.ChannelBaseUrl)
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
	normalized, err := normalizeRequest(req)
	if err != nil {
		return service.TaskErrorWrapperLocal(err, "invalid_request", http.StatusBadRequest)
	}
	relaycommon.SetTaskRequest(c, normalized.request)
	return nil
}

func (a *TaskAdaptor) BuildRequestURL(_ *relaycommon.RelayInfo) (string, error) {
	return a.baseURL + submitPath, nil
}

func (a *TaskAdaptor) BuildRequestHeader(_ *gin.Context, req *http.Request, _ *relaycommon.RelayInfo) error {
	req.Header.Set("Authorization", "Bearer "+a.apiKey)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json")
	return nil
}

func (a *TaskAdaptor) BuildRequestBody(c *gin.Context, info *relaycommon.RelayInfo) (io.Reader, error) {
	req, err := relaycommon.GetTaskRequest(c)
	if err != nil {
		return nil, err
	}
	normalized, err := normalizeRequest(req)
	if err != nil {
		return nil, err
	}
	modelName := strings.TrimSpace(info.UpstreamModelName)
	if modelName == "" {
		modelName = normalized.model
	}
	payload := submitPayload{
		Model:       modelName,
		Prompt:      strings.TrimSpace(normalized.request.Prompt),
		Mode:        normalized.mode,
		Seconds:     strconv.Itoa(normalized.request.Duration),
		Size:        strings.ToUpper(normalized.resolution),
		AspectRatio: normalized.aspectRatio,
		Seed:        normalized.request.Seed,
		N:           normalized.request.N,
		FirstFrame:  strings.TrimSpace(normalized.request.StartFrame),
		LastFrame:   strings.TrimSpace(normalized.request.EndFrame),
		Images:      normalized.request.Images,
		Audios:      normalized.request.ReferenceAudios,
		Videos:      normalized.request.VideoReferences,
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
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return "", nil, service.TaskErrorWrapper(err, "read_response_body_failed", http.StatusInternalServerError)
	}
	_ = resp.Body.Close()
	var response videoResponse
	if err := common.Unmarshal(body, &response); err != nil {
		return "", nil, service.TaskErrorWrapper(fmt.Errorf("unmarshal Agnes response: %w", err), "unmarshal_response_body_failed", http.StatusInternalServerError)
	}
	if strings.TrimSpace(response.VideoID) == "" {
		message := response.errorMessage()
		if message == "" {
			message = "Agnes video submission returned no video_id"
		}
		return "", body, service.TaskErrorWrapper(errors.New(message), "agnes_submit_failed", http.StatusBadGateway)
	}

	result := response.toOpenAIVideo(info.PublicTaskID, info.OriginModelName)
	c.JSON(http.StatusOK, result)
	pollModel := strings.TrimSpace(response.Model)
	if pollModel == "" {
		pollModel = strings.TrimSpace(info.UpstreamModelName)
	}
	if pollModel == "" {
		pollModel = strings.TrimSpace(info.OriginModelName)
	}
	encodedID, err := encodePollIdentity(response.VideoID, pollModel)
	if err != nil {
		return "", body, service.TaskErrorWrapper(err, "agnes_task_id_encode_failed", http.StatusInternalServerError)
	}
	return encodedID, body, nil
}

func (a *TaskAdaptor) FetchTask(baseURL, key string, body map[string]any, proxy string) (*http.Response, error) {
	encodedID, ok := body["task_id"].(string)
	if !ok || strings.TrimSpace(encodedID) == "" {
		return nil, errors.New("invalid task_id")
	}
	identity, err := decodePollIdentity(encodedID)
	if err != nil {
		return nil, err
	}
	query := url.Values{}
	query.Set("video_id", identity.VideoID)
	query.Set("model_name", identity.Model)
	requestURL := agnesRoot(baseURL) + fetchPath + "?" + query.Encode()
	req, err := http.NewRequest(http.MethodGet, requestURL, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", "Bearer "+key)
	req.Header.Set("Accept", "application/json")
	client, err := service.GetHttpClientWithProxy(proxy)
	if err != nil {
		return nil, fmt.Errorf("new proxy http client failed: %w", err)
	}
	if client == nil {
		client = http.DefaultClient
	}
	return client.Do(req)
}

func (a *TaskAdaptor) ParseTaskResult(body []byte) (*relaycommon.TaskInfo, error) {
	var response videoResponse
	if err := common.Unmarshal(body, &response); err != nil {
		return nil, fmt.Errorf("unmarshal Agnes task result failed: %w", err)
	}
	result := &relaycommon.TaskInfo{Progress: progressString(response.Progress)}
	switch strings.ToLower(strings.TrimSpace(response.Status)) {
	case "queued":
		result.Status = model.TaskStatusQueued
	case "in_progress", "processing", "running":
		result.Status = model.TaskStatusInProgress
	case "completed", "succeeded", "success":
		result.Status = model.TaskStatusSuccess
		result.Progress = taskcommon.ProgressComplete
		result.Url = response.resultURL()
		if result.Url == "" {
			return nil, fmt.Errorf("Agnes video %q completed without a result URL", response.VideoID)
		}
	case "failed", "cancelled", "canceled":
		result.Status = model.TaskStatusFailure
		result.Progress = taskcommon.ProgressComplete
		result.Reason = response.errorMessage()
		if result.Reason == "" {
			result.Reason = response.Status
		}
	default:
		if message := response.errorMessage(); message != "" {
			result.Status = model.TaskStatusFailure
			result.Progress = taskcommon.ProgressComplete
			result.Reason = message
		} else {
			return nil, fmt.Errorf("Agnes video %q returned unknown status %q", response.VideoID, response.Status)
		}
	}
	return result, nil
}

func (a *TaskAdaptor) ConvertToOpenAIVideo(task *model.Task) ([]byte, error) {
	result := dto.NewOpenAIVideo()
	result.ID = task.TaskID
	result.TaskID = task.TaskID
	result.Model = task.Properties.OriginModelName
	result.Status = task.Status.ToVideoStatus()
	result.SetProgressStr(task.Progress)
	result.CreatedAt = task.CreatedAt
	result.CompletedAt = task.UpdatedAt
	if url := strings.TrimSpace(task.GetResultURL()); url != "" {
		result.SetMetadata("url", url)
	}
	if len(task.Data) > 0 {
		var response videoResponse
		if common.Unmarshal(task.Data, &response) == nil {
			if response.Seconds != "" {
				result.Seconds = response.Seconds
			}
			if response.Size != "" {
				result.Size = response.Size
			}
			if url := response.resultURL(); url != "" {
				result.SetMetadata("url", url)
			}
			if message := response.errorMessage(); message != "" && task.Status == model.TaskStatusFailure {
				code := ""
				if response.Error != nil {
					code = strings.TrimSpace(response.Error.Code)
				}
				result.Error = &dto.OpenAIVideoError{Message: message, Code: code}
			}
		}
	}
	return common.Marshal(result)
}

func (a *TaskAdaptor) GetModelList() []string { return ModelList }

func (a *TaskAdaptor) GetChannelName() string { return ChannelName }

func normalizeRequest(req relaycommon.TaskSubmitReq) (normalizedRequest, error) {
	modelName := strings.TrimSpace(req.Model)
	if modelName != ModelVideo25 && modelName != ModelVideo25Flash {
		return normalizedRequest{}, fmt.Errorf("agnes: unsupported video model %q", modelName)
	}
	if strings.TrimSpace(req.Prompt) == "" {
		return normalizedRequest{}, fmt.Errorf("agnes %s: prompt is required", modelName)
	}
	duration := req.Duration
	if duration <= 0 && strings.TrimSpace(req.Seconds) != "" {
		parsed, err := strconv.Atoi(strings.TrimSpace(req.Seconds))
		if err != nil {
			return normalizedRequest{}, fmt.Errorf("agnes %s: seconds must be an integer string", modelName)
		}
		duration = parsed
	}
	if duration <= 0 {
		duration = 5
	}
	if duration < 4 || duration > 12 {
		return normalizedRequest{}, fmt.Errorf("agnes %s: seconds must be between 4 and 12", modelName)
	}
	if req.N != nil && *req.N != 1 {
		return normalizedRequest{}, fmt.Errorf("agnes %s: n must be 1", modelName)
	}

	resolution, aspectRatio, err := resolveVideoSpec(req)
	if err != nil {
		return normalizedRequest{}, fmt.Errorf("agnes %s: %w", modelName, err)
	}
	if modelName == ModelVideo25Flash && resolution != "720p" {
		return normalizedRequest{}, fmt.Errorf("agnes-video-2.5-flash size must be 720P")
	}
	if resolution == "1k" {
		aspectRatio = "1:1"
	}

	images := uniqueStrings(req.Images)
	audios := uniqueStrings(append(append([]string{}, req.ReferenceAudios...), req.Audios...))
	videos := append([]relaycommon.TaskVideoReference(nil), req.VideoReferences...)
	for _, value := range uniqueStrings(req.ReferenceVideos) {
		videos = append(videos, relaycommon.TaskVideoReference{URL: value})
	}
	if err := validateAgnesMediaURL("first_frame", req.StartFrame); err != nil {
		return normalizedRequest{}, err
	}
	if err := validateAgnesMediaURL("last_frame", req.EndFrame); err != nil {
		return normalizedRequest{}, err
	}
	for index, value := range images {
		if err := validateAgnesMediaURL(fmt.Sprintf("images[%d]", index), value); err != nil {
			return normalizedRequest{}, err
		}
	}
	for index, value := range audios {
		if err := validateAgnesMediaURL(fmt.Sprintf("audios[%d]", index), value); err != nil {
			return normalizedRequest{}, err
		}
	}
	for index := range videos {
		videos[index].URL = strings.TrimSpace(videos[index].URL)
		if videos[index].URL == "" {
			return normalizedRequest{}, fmt.Errorf("videos[%d].url is required", index)
		}
		if err := validateAgnesMediaURL(fmt.Sprintf("videos[%d].url", index), videos[index].URL); err != nil {
			return normalizedRequest{}, err
		}
		if videos[index].StartSeconds != nil && *videos[index].StartSeconds < 0 {
			return normalizedRequest{}, fmt.Errorf("videos[%d].start_seconds must be non-negative", index)
		}
	}

	mode := strings.ToLower(strings.TrimSpace(req.Mode))
	if mode == "" {
		switch {
		case strings.TrimSpace(req.StartFrame) != "" || strings.TrimSpace(req.EndFrame) != "":
			mode = "keyframe"
		case len(images)+len(audios)+len(videos) > 0:
			mode = "reference"
		default:
			mode = "text"
		}
	}
	if mode != "text" && mode != "keyframe" && mode != "reference" {
		return normalizedRequest{}, fmt.Errorf("mode must be text, keyframe, or reference")
	}
	hasFrames := strings.TrimSpace(req.StartFrame) != "" || strings.TrimSpace(req.EndFrame) != ""
	hasReferences := len(images)+len(audios)+len(videos) > 0
	switch mode {
	case "text":
		if hasFrames || hasReferences {
			return normalizedRequest{}, fmt.Errorf("text mode does not accept reference media")
		}
	case "keyframe":
		if !hasFrames {
			return normalizedRequest{}, fmt.Errorf("keyframe mode requires first_frame or last_frame")
		}
		if hasReferences {
			return normalizedRequest{}, fmt.Errorf("keyframe mode does not accept images, audios, or videos")
		}
	case "reference":
		if hasFrames {
			return normalizedRequest{}, fmt.Errorf("reference mode does not accept first_frame or last_frame")
		}
		if !hasReferences {
			return normalizedRequest{}, fmt.Errorf("reference mode requires images, audios, or videos")
		}
	}

	if modelName == ModelVideo25Flash {
		if len(images) > 5 {
			return normalizedRequest{}, fmt.Errorf("images length must not exceed 5")
		}
		if len(audios) > 3 {
			return normalizedRequest{}, fmt.Errorf("audios length must not exceed 3")
		}
		if len(videos) > 0 {
			return normalizedRequest{}, fmt.Errorf("videos is not supported by agnes-video-2.5-flash")
		}
	} else {
		if len(images) > 8 {
			return normalizedRequest{}, fmt.Errorf("images length must not exceed 8")
		}
		if len(audios) > 3 {
			return normalizedRequest{}, fmt.Errorf("audios length must not exceed 3")
		}
		if len(videos) > 1 {
			return normalizedRequest{}, fmt.Errorf("videos length must not exceed 1")
		}
		if len(images)+len(audios)+len(videos) > 12 {
			return normalizedRequest{}, fmt.Errorf("reference media count must not exceed 12")
		}
	}

	req.Model = modelName
	req.Mode = mode
	req.Duration = duration
	req.Seconds = strconv.Itoa(duration)
	req.Resolution = resolution
	req.Size = strings.ToUpper(resolution)
	req.AspectRatio = aspectRatio
	req.Images = images
	req.ReferenceAudios = audios
	req.VideoReferences = videos
	return normalizedRequest{
		request:     req,
		model:       modelName,
		mode:        mode,
		resolution:  resolution,
		aspectRatio: aspectRatio,
	}, nil
}

func validateAgnesMediaURL(field, value string) error {
	value = strings.TrimSpace(value)
	if value == "" {
		return nil
	}
	parsed, err := url.Parse(value)
	if err != nil || !strings.EqualFold(parsed.Scheme, "https") || strings.TrimSpace(parsed.Host) == "" {
		return fmt.Errorf("%s must be a public HTTPS URL accessible by Agnes", field)
	}
	return nil
}

func resolveVideoSpec(req relaycommon.TaskSubmitReq) (string, string, error) {
	rawResolution := strings.TrimSpace(req.Resolution)
	if rawResolution == "" && req.Metadata != nil {
		if value, ok := req.Metadata["resolution"].(string); ok {
			rawResolution = strings.TrimSpace(value)
		}
	}
	resolution := normalizeResolution(rawResolution)
	if rawResolution != "" && resolution == "" {
		return "", "", fmt.Errorf("size must be 720P, 1080P, 1K, or 2K")
	}
	ratio := strings.TrimSpace(req.AspectRatio)
	if ratio == "" && req.Metadata != nil {
		if value, ok := req.Metadata["aspect_ratio"].(string); ok {
			ratio = strings.TrimSpace(value)
		}
	}
	size := strings.TrimSpace(req.Size)
	if resolution == "" && normalizeResolution(size) != "" {
		resolution = normalizeResolution(size)
	}
	if mappedResolution, mappedRatio, ok := videoPixelSpec(size); ok {
		if resolution == "" {
			resolution = mappedResolution
		}
		if ratio == "" {
			ratio = mappedRatio
		}
	} else if ratio == "" && strings.Contains(size, ":") {
		ratio = size
	} else if resolution == "" && size != "" && !strings.EqualFold(size, "auto") {
		return "", "", fmt.Errorf("size must be 720P, 1080P, 1K, or 2K")
	}
	if resolution == "" {
		resolution = "720p"
	}
	if resolution != "720p" && resolution != "1080p" && resolution != "1k" && resolution != "2k" {
		return "", "", fmt.Errorf("size must be 720P, 1080P, 1K, or 2K")
	}
	if ratio == "" {
		ratio = "16:9"
	}
	if _, ok := validRatios[ratio]; !ok {
		return "", "", fmt.Errorf("unsupported aspect_ratio %q", ratio)
	}
	return resolution, ratio, nil
}

func normalizeResolution(value string) string {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case "720", "720p":
		return "720p"
	case "1080", "1080p":
		return "1080p"
	case "1k":
		return "1k"
	case "2k", "1440p":
		return "2k"
	default:
		return ""
	}
}

func videoPixelSpec(value string) (string, string, bool) {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case "1470x630", "1680x720":
		return "720p", "21:9", true
	case "1280x720", "1280x704":
		return "720p", "16:9", true
	case "1112x834", "960x720":
		return "720p", "4:3", true
	case "960x960", "720x720":
		return "720p", "1:1", true
	case "834x1112", "720x960":
		return "720p", "3:4", true
	case "720x1280":
		return "720p", "9:16", true
	case "2206x946":
		return "1080p", "21:9", true
	case "1920x1080":
		return "1080p", "16:9", true
	case "1664x1248":
		return "1080p", "4:3", true
	case "1440x1440":
		return "1080p", "1:1", true
	case "1248x1664":
		return "1080p", "3:4", true
	case "1080x1920":
		return "1080p", "9:16", true
	case "1024x1024":
		return "1k", "1:1", true
	case "2940x1260":
		return "2k", "21:9", true
	case "2560x1440":
		return "2k", "16:9", true
	case "2224x1668":
		return "2k", "4:3", true
	case "1920x1920":
		return "2k", "1:1", true
	case "1668x2224":
		return "2k", "3:4", true
	case "1440x2560":
		return "2k", "9:16", true
	default:
		return "", "", false
	}
}

func uniqueStrings(values []string) []string {
	result := make([]string, 0, len(values))
	seen := make(map[string]struct{}, len(values))
	for _, value := range values {
		value = strings.TrimSpace(value)
		if value == "" {
			continue
		}
		if _, exists := seen[value]; exists {
			continue
		}
		seen[value] = struct{}{}
		result = append(result, value)
	}
	return result
}

func encodePollIdentity(videoID, modelName string) (string, error) {
	identity := pollIdentity{VideoID: strings.TrimSpace(videoID), Model: strings.TrimSpace(modelName)}
	if identity.VideoID == "" || (identity.Model != ModelVideo25 && identity.Model != ModelVideo25Flash) {
		return "", errors.New("invalid Agnes poll identity")
	}
	data, err := common.Marshal(identity)
	if err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(data), nil
}

func decodePollIdentity(value string) (pollIdentity, error) {
	data, err := base64.RawURLEncoding.DecodeString(strings.TrimSpace(value))
	if err != nil {
		return pollIdentity{}, errors.New("invalid Agnes task identity")
	}
	var identity pollIdentity
	if common.Unmarshal(data, &identity) != nil || strings.TrimSpace(identity.VideoID) == "" ||
		(identity.Model != ModelVideo25 && identity.Model != ModelVideo25Flash) {
		return pollIdentity{}, errors.New("invalid Agnes task identity")
	}
	return identity, nil
}

func agnesRoot(baseURL string) string {
	root := strings.TrimRight(strings.TrimSpace(baseURL), "/")
	return strings.TrimSuffix(root, "/v1")
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

func (response *videoResponse) resultURL() string {
	if response == nil {
		return ""
	}
	if response.Metadata != nil {
		if value := strings.TrimSpace(response.Metadata.URL); value != "" {
			return value
		}
	}
	// Agnes currently returns the completed asset in a top-level `url` field,
	// while its published schema and some responses use `metadata.url`.
	return strings.TrimSpace(response.URL)
}

func (response *videoResponse) errorMessage() string {
	if response == nil {
		return ""
	}
	if response.Error != nil && strings.TrimSpace(response.Error.Message) != "" {
		return strings.TrimSpace(response.Error.Message)
	}
	if strings.TrimSpace(response.Message) != "" {
		return strings.TrimSpace(response.Message)
	}
	if len(response.Detail) > 0 && string(response.Detail) != "null" {
		var detail string
		if common.Unmarshal(response.Detail, &detail) == nil {
			return strings.TrimSpace(detail)
		}
	}
	return ""
}

func (response *videoResponse) toOpenAIVideo(publicTaskID, publicModel string) *dto.OpenAIVideo {
	result := dto.NewOpenAIVideo()
	result.ID = publicTaskID
	result.TaskID = publicTaskID
	result.Model = publicModel
	switch strings.ToLower(strings.TrimSpace(response.Status)) {
	case "queued", "pending":
		result.Status = dto.VideoStatusQueued
	case "in_progress", "processing", "running":
		result.Status = dto.VideoStatusInProgress
	case "completed", "succeeded", "success":
		result.Status = dto.VideoStatusCompleted
	case "failed", "cancelled", "canceled":
		result.Status = dto.VideoStatusFailed
	default:
		result.Status = dto.VideoStatusQueued
	}
	result.Progress = response.Progress
	result.CreatedAt = response.CreatedAt
	if result.CreatedAt == 0 {
		result.CreatedAt = time.Now().Unix()
	}
	result.CompletedAt = response.CompletedAt
	result.Seconds = response.Seconds
	result.Size = response.Size
	if url := response.resultURL(); url != "" {
		result.SetMetadata("url", url)
	}
	return result
}
