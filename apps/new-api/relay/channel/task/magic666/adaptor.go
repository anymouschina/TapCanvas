package magic666

import (
	"bytes"
	"encoding/base64"
	"fmt"
	"io"
	"mime/multipart"
	"net/http"
	"net/textproto"
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
	"github.com/pkg/errors"
	"github.com/samber/lo"
	"github.com/tidwall/sjson"
)

type responseTask struct {
	ID                 string `json:"id"`
	TaskID             string `json:"task_id,omitempty"`
	Object             string `json:"object"`
	Model              string `json:"model"`
	Status             string `json:"status"`
	Progress           int    `json:"progress"`
	CreatedAt          int64  `json:"created_at"`
	CompletedAt        int64  `json:"completed_at,omitempty"`
	ExpiresAt          int64  `json:"expires_at,omitempty"`
	Seconds            string `json:"seconds,omitempty"`
	Size               string `json:"size,omitempty"`
	RemixedFromVideoID string `json:"remixed_from_video_id,omitempty"`
	Error              *struct {
		Message string `json:"message"`
		Code    string `json:"code"`
	} `json:"error,omitempty"`
}

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
	taskErr := relaycommon.ValidateBasicTaskRequest(c, info, constant.TaskActionGenerate)
	if taskErr != nil {
		return taskErr
	}
	req, err := relaycommon.GetTaskRequest(c)
	if err != nil {
		return service.TaskErrorWrapperLocal(err, "invalid_request", http.StatusBadRequest)
	}
	size := strings.TrimSpace(req.Size)
	if size == "" {
		size = "720x1280"
		req.Size = size
	}
	if !lo.Contains([]string{"720x1280", "1280x720"}, size) {
		return service.TaskErrorWrapperLocal(fmt.Errorf("magic666 video size is invalid"), "invalid_size", http.StatusBadRequest)
	}
	modelName, err := magic666PublicModelName(info, req)
	if err != nil {
		return service.TaskErrorWrapperLocal(err, "invalid_model", http.StatusBadRequest)
	}
	seconds, err := magic666VideoSeconds(req, modelName)
	if err != nil {
		return service.TaskErrorWrapperLocal(err, "invalid_seconds", http.StatusBadRequest)
	}
	modelName, err = magic666UpstreamModelName(info, req, seconds)
	if err != nil {
		return service.TaskErrorWrapperLocal(err, "invalid_model", http.StatusBadRequest)
	}
	req.Model = modelName
	req.Seconds = strconv.Itoa(seconds)
	c.Set("task_request", req)
	return nil
}

func magic666VideoSeconds(req relaycommon.TaskSubmitReq, upstreamModelName string) (int, error) {
	seconds := req.Duration
	if strings.TrimSpace(req.Seconds) != "" {
		parsed, err := strconv.Atoi(strings.TrimSpace(req.Seconds))
		if err != nil {
			return 0, fmt.Errorf("magic666 video seconds is invalid")
		}
		seconds = parsed
	}
	modelName := strings.TrimSpace(upstreamModelName)
	if modelName == "" {
		modelName = strings.TrimSpace(req.Model)
	}
	allowedSeconds := []int{10, 15}
	defaultSeconds := 10
	if isMagic666Sora2Model(modelName) {
		allowedSeconds = []int{4, 8, 12}
		defaultSeconds = 4
		if modelName == "sora-2-8s" {
			defaultSeconds = 8
		} else if modelName == "sora-2-12s" {
			defaultSeconds = 12
		}
	} else if isMagic666VeoModel(modelName) {
		allowedSeconds = []int{8}
		defaultSeconds = 8
	}
	if seconds == 0 {
		seconds = defaultSeconds
	}
	if !lo.Contains(allowedSeconds, seconds) {
		return 0, fmt.Errorf("magic666 video seconds is invalid for %s (must be %s)", modelName, formatAllowedSeconds(allowedSeconds))
	}
	return seconds, nil
}

func magic666PublicModelName(info *relaycommon.RelayInfo, req relaycommon.TaskSubmitReq) (string, error) {
	if info != nil && info.ChannelMeta != nil {
		if modelName := strings.TrimSpace(info.ChannelMeta.UpstreamModelName); modelName != "" {
			if isMagic666VeoModel(modelName) {
				return "", fmt.Errorf("magic666 veo models are delisted")
			}
			return modelName, nil
		}
	}
	modelName := strings.TrimSpace(req.Model)
	if isMagic666VeoModel(modelName) {
		return "", fmt.Errorf("magic666 veo models are delisted")
	}
	return modelName, nil
}

func magic666UpstreamModelName(info *relaycommon.RelayInfo, req relaycommon.TaskSubmitReq, seconds int) (string, error) {
	modelName, err := magic666PublicModelName(info, req)
	if err != nil {
		return "", err
	}
	if isMagic666Sora2Model(modelName) {
		return resolveMagic666Sora2UpstreamModel(seconds)
	}
	if isMagic666VeoModel(modelName) {
		return "", fmt.Errorf("magic666 veo models are delisted")
	}
	return modelName, nil
}

func isMagic666Sora2Model(modelName string) bool {
	switch strings.TrimSpace(modelName) {
	case "sora2", "sora-2", "sora-2-8s", "sora-2-12s", "sora-2-oai":
		return true
	default:
		return false
	}
}

func resolveMagic666Sora2UpstreamModel(seconds int) (string, error) {
	switch seconds {
	case 4:
		return "sora-2", nil
	case 8:
		return "sora-2-8s", nil
	case 12:
		return "sora-2-12s", nil
	default:
		return "", fmt.Errorf("magic666 sora2 seconds is invalid (must be 4, 8, or 12)")
	}
}

func isMagic666VeoModel(modelName string) bool {
	switch strings.TrimSpace(modelName) {
	case "veo-3.1",
		"veo_3_1",
		"veo_3_1-4K",
		"veo_3_1-fast",
		"veo_3_1-fast-4K",
		"veo_3_1-components",
		"veo_3_1-components-4K",
		"veo_3_1-fast-components",
		"veo_3_1-fast-components-4K",
		"veo3.1-pro",
		"veo3.1-fast":
		return true
	default:
		return false
	}
}

func resolveMagic666VeoModel(c *gin.Context, req relaycommon.TaskSubmitReq) (string, error) {
	size := strings.TrimSpace(req.Size)
	if size == "" {
		size = "720x1280"
	}
	isFast := magic666BoolMetadata(req.Metadata, "fast") ||
		magic666StringMetadata(req.Metadata, "mode") == "fast" ||
		magic666StringMetadata(req.Metadata, "speed") == "fast" ||
		magic666StringMetadata(req.Metadata, "quality") == "fast" ||
		strings.TrimSpace(req.Mode) == "fast"
	isComponents := magic666ReferenceImageCount(c, req) >= 3 ||
		magic666BoolMetadata(req.Metadata, "components") ||
		magic666BoolMetadata(req.Metadata, "referenceMode") ||
		magic666StringMetadata(req.Metadata, "mode") == "components" ||
		magic666StringMetadata(req.Metadata, "mode") == "reference"
	is4K := magic666BoolMetadata(req.Metadata, "enable_upsample") ||
		strings.EqualFold(strings.TrimSpace(req.Resolution), "4K") ||
		strings.EqualFold(magic666StringMetadata(req.Metadata, "resolution"), "4K") ||
		strings.EqualFold(magic666StringMetadata(req.Metadata, "imageSize"), "4K")
	if is4K && size != "1280x720" {
		return "", fmt.Errorf("magic666 veo 4K is only supported for landscape size 1280x720")
	}
	modelName := "veo_3_1"
	if isFast {
		modelName += "-fast"
	}
	if isComponents {
		modelName += "-components"
	}
	if is4K {
		modelName += "-4K"
	}
	return modelName, nil
}

func magic666ReferenceImageCount(c *gin.Context, req relaycommon.TaskSubmitReq) int {
	count := 0
	if strings.TrimSpace(req.Image) != "" {
		count++
	}
	if strings.TrimSpace(req.InputReference) != "" {
		count++
	}
	count += len(req.Images)
	count += len(req.ReferenceImages)
	count += len(req.Urls)
	if form, err := common.ParseMultipartFormReusable(c); err == nil {
		count += len(form.File["input_reference"])
	}
	return count
}

func magic666BoolMetadata(metadata map[string]interface{}, key string) bool {
	if metadata == nil {
		return false
	}
	value, exists := metadata[key]
	if !exists || value == nil {
		return false
	}
	switch typed := value.(type) {
	case bool:
		return typed
	case string:
		parsed, err := strconv.ParseBool(strings.TrimSpace(typed))
		return err == nil && parsed
	default:
		return false
	}
}

func magic666StringMetadata(metadata map[string]interface{}, key string) string {
	if metadata == nil {
		return ""
	}
	value, exists := metadata[key]
	if !exists || value == nil {
		return ""
	}
	switch typed := value.(type) {
	case string:
		return strings.TrimSpace(typed)
	default:
		return strings.TrimSpace(fmt.Sprint(typed))
	}
}

func formatAllowedSeconds(values []int) string {
	parts := make([]string, 0, len(values))
	for _, value := range values {
		parts = append(parts, strconv.Itoa(value))
	}
	return strings.Join(parts, ", ")
}

func (a *TaskAdaptor) BuildRequestURL(info *relaycommon.RelayInfo) (string, error) {
	return a.baseURL + "/v1/videos", nil
}

func (a *TaskAdaptor) BuildRequestHeader(c *gin.Context, req *http.Request, info *relaycommon.RelayInfo) error {
	req.Header.Set("Authorization", "Bearer "+a.apiKey)
	req.Header.Set("Content-Type", c.Request.Header.Get("Content-Type"))
	return nil
}

func (a *TaskAdaptor) BuildRequestBody(c *gin.Context, info *relaycommon.RelayInfo) (io.Reader, error) {
	req, err := relaycommon.GetTaskRequest(c)
	if err != nil {
		return nil, err
	}
	seconds, secondsErr := magic666VideoSeconds(req, strings.TrimSpace(req.Model))
	if secondsErr != nil {
		return nil, secondsErr
	}
	req.Model, err = magic666UpstreamModelName(info, req, seconds)
	if err != nil {
		return nil, err
	}
	req.Seconds = strconv.Itoa(seconds)
	if req.Model == "" {
		return nil, fmt.Errorf("magic666 video model is required")
	}
	return buildMultipartVideoBody(c, req)
}

func (a *TaskAdaptor) EstimateBilling(c *gin.Context, info *relaycommon.RelayInfo) map[string]float64 {
	req, err := relaycommon.GetTaskRequest(c)
	if err != nil {
		return nil
	}
	if !isMagic666Sora2Model(info.OriginModelName) {
		return nil
	}
	seconds, err := magic666VideoSeconds(req, info.OriginModelName)
	if err != nil {
		return nil
	}
	return map[string]float64{
		"seconds": float64(seconds) / 4.0,
	}
}

func buildMultipartVideoBody(c *gin.Context, req relaycommon.TaskSubmitReq) (io.Reader, error) {
	var buf bytes.Buffer
	writer := multipart.NewWriter(&buf)
	if err := writer.WriteField("model", req.Model); err != nil {
		return nil, err
	}
	if err := writer.WriteField("prompt", req.Prompt); err != nil {
		return nil, err
	}
	writeOptionalField(writer, "size", req.Size)
	if req.Seconds != "" {
		writeOptionalField(writer, "seconds", req.Seconds)
	} else if req.Duration > 0 {
		writeOptionalField(writer, "seconds", strconv.Itoa(req.Duration))
	}
	if req.Metadata != nil {
		writeMetadataField(writer, req.Metadata, "character_url")
		writeMetadataField(writer, req.Metadata, "character_timestamps")
	}
	if strings.Contains(req.Model, "-4K") {
		writeOptionalField(writer, "enable_upsample", "true")
	}
	if form, err := common.ParseMultipartFormReusable(c); err == nil {
		if err := copyMultipartFiles(writer, form, "input_reference"); err != nil {
			return nil, err
		}
	}
	if err := writeReferenceImageFiles(c, writer, req); err != nil {
		return nil, err
	}
	if err := writer.Close(); err != nil {
		return nil, err
	}
	c.Request.Header.Set("Content-Type", writer.FormDataContentType())
	return &buf, nil
}

func writeOptionalField(writer *multipart.Writer, key string, value string) {
	value = strings.TrimSpace(value)
	if value == "" {
		return
	}
	_ = writer.WriteField(key, value)
}

func writeMetadataField(writer *multipart.Writer, metadata map[string]interface{}, key string) {
	value, exists := metadata[key]
	if !exists || value == nil {
		return
	}
	writeOptionalField(writer, key, fmt.Sprint(value))
}

func copyMultipartFiles(writer *multipart.Writer, form *multipart.Form, fieldName string) error {
	for _, fileHeader := range form.File[fieldName] {
		file, err := fileHeader.Open()
		if err != nil {
			return fmt.Errorf("magic666 open multipart %s failed: %w", fieldName, err)
		}
		contentType := fileHeader.Header.Get("Content-Type")
		if contentType == "" {
			contentType = "application/octet-stream"
		}
		header := make(textproto.MIMEHeader)
		header.Set("Content-Disposition", fmt.Sprintf(`form-data; name="%s"; filename="%s"`, fieldName, fileHeader.Filename))
		header.Set("Content-Type", contentType)
		part, err := writer.CreatePart(header)
		if err != nil {
			_ = file.Close()
			return fmt.Errorf("magic666 create multipart %s failed: %w", fieldName, err)
		}
		if _, err := io.Copy(part, file); err != nil {
			_ = file.Close()
			return fmt.Errorf("magic666 copy multipart %s failed: %w", fieldName, err)
		}
		if err := file.Close(); err != nil {
			return fmt.Errorf("magic666 close multipart %s failed: %w", fieldName, err)
		}
	}
	return nil
}

func writeReferenceImageFiles(c *gin.Context, writer *multipart.Writer, req relaycommon.TaskSubmitReq) error {
	references := magic666ReferenceImageValues(req)
	for idx, reference := range references {
		mimeType, data, err := magic666LoadReferenceImage(c, reference)
		if err != nil {
			return err
		}
		filename := fmt.Sprintf("input_reference_%d%s", idx+1, magic666ImageExtension(mimeType))
		if err := writeMultipartBytes(writer, "input_reference", filename, mimeType, data); err != nil {
			return err
		}
	}
	return nil
}

func magic666ReferenceImageValues(req relaycommon.TaskSubmitReq) []string {
	seen := make(map[string]struct{})
	out := make([]string, 0, 1+len(req.Images)+len(req.Urls)+len(req.ReferenceImages))
	push := func(value string) {
		value = strings.TrimSpace(value)
		if value == "" {
			return
		}
		if _, exists := seen[value]; exists {
			return
		}
		seen[value] = struct{}{}
		out = append(out, value)
	}
	push(req.Image)
	push(req.InputReference)
	for _, value := range req.Images {
		push(value)
	}
	for _, value := range req.Urls {
		push(value)
	}
	for _, value := range req.ReferenceImages {
		push(value)
	}
	return out
}

func magic666LoadReferenceImage(c *gin.Context, reference string) (string, []byte, error) {
	reference = strings.TrimSpace(reference)
	if strings.HasPrefix(reference, "data:") {
		mimeType, encoded, err := service.DecodeBase64FileData(reference)
		if err != nil {
			return "", nil, fmt.Errorf("magic666 decode input_reference failed: %w", err)
		}
		data, err := base64.StdEncoding.DecodeString(encoded)
		if err != nil {
			return "", nil, fmt.Errorf("magic666 decode input_reference bytes failed: %w", err)
		}
		return mimeType, data, nil
	}
	mimeType, encoded, err := service.GetImageFromUrl(reference)
	if err != nil {
		return "", nil, fmt.Errorf("magic666 download input_reference failed: %w", err)
	}
	data, err := base64.StdEncoding.DecodeString(encoded)
	if err != nil {
		return "", nil, fmt.Errorf("magic666 decode downloaded input_reference failed: %w", err)
	}
	return mimeType, data, nil
}

func writeMultipartBytes(writer *multipart.Writer, fieldName string, filename string, contentType string, data []byte) error {
	if contentType == "" {
		contentType = "application/octet-stream"
	}
	header := make(textproto.MIMEHeader)
	header.Set("Content-Disposition", fmt.Sprintf(`form-data; name="%s"; filename="%s"`, fieldName, filename))
	header.Set("Content-Type", contentType)
	part, err := writer.CreatePart(header)
	if err != nil {
		return fmt.Errorf("magic666 create %s file part failed: %w", fieldName, err)
	}
	if _, err := part.Write(data); err != nil {
		return fmt.Errorf("magic666 write %s file part failed: %w", fieldName, err)
	}
	return nil
}

func magic666ImageExtension(mimeType string) string {
	switch strings.ToLower(strings.TrimSpace(mimeType)) {
	case "image/jpeg", "image/jpg":
		return ".jpg"
	case "image/png":
		return ".png"
	case "image/gif":
		return ".gif"
	case "image/webp":
		return ".webp"
	default:
		return ".img"
	}
}

func (a *TaskAdaptor) DoRequest(c *gin.Context, info *relaycommon.RelayInfo, requestBody io.Reader) (*http.Response, error) {
	return channel.DoTaskApiRequest(a, c, info, requestBody)
}

func (a *TaskAdaptor) DoResponse(c *gin.Context, resp *http.Response, info *relaycommon.RelayInfo) (taskID string, taskData []byte, taskErr *dto.TaskError) {
	responseBody, err := io.ReadAll(resp.Body)
	if err != nil {
		return "", nil, service.TaskErrorWrapper(err, "read_response_body_failed", http.StatusInternalServerError)
	}
	_ = resp.Body.Close()
	var upstream responseTask
	if err := common.Unmarshal(responseBody, &upstream); err != nil {
		return "", responseBody, service.TaskErrorWrapper(errors.Wrapf(err, "body: %s", responseBody), "unmarshal_response_body_failed", http.StatusInternalServerError)
	}
	upstreamID := upstream.ID
	if upstreamID == "" {
		upstreamID = upstream.TaskID
	}
	if upstreamID == "" {
		return "", responseBody, service.TaskErrorWrapper(fmt.Errorf("task_id is empty"), "invalid_response", http.StatusInternalServerError)
	}
	upstream.ID = info.PublicTaskID
	upstream.TaskID = info.PublicTaskID
	c.JSON(http.StatusOK, upstream)
	return upstreamID, responseBody, nil
}

func (a *TaskAdaptor) FetchTask(baseURL string, key string, body map[string]any, proxy string) (*http.Response, error) {
	taskID, ok := body["task_id"].(string)
	if !ok || strings.TrimSpace(taskID) == "" {
		return nil, fmt.Errorf("invalid task_id")
	}
	req, err := http.NewRequest(http.MethodGet, fmt.Sprintf("%s/v1/videos/%s", baseURL, taskID), nil)
	if err != nil {
		return nil, err
	}
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
	var task responseTask
	if err := common.Unmarshal(respBody, &task); err != nil {
		return nil, errors.Wrap(err, "unmarshal task result failed")
	}
	result := &relaycommon.TaskInfo{}
	switch strings.ToLower(task.Status) {
	case "queued", "pending":
		result.Status = model.TaskStatusQueued
		result.Progress = taskcommon.ProgressQueued
	case "processing", "in_progress":
		result.Status = model.TaskStatusInProgress
		result.Progress = progressString(task.Progress)
	case "completed", "succeeded", "success":
		result.Status = model.TaskStatusSuccess
		result.Progress = taskcommon.ProgressComplete
	case "failed", "cancelled", "canceled":
		result.Status = model.TaskStatusFailure
		result.Progress = taskcommon.ProgressComplete
		if task.Error != nil {
			result.Reason = task.Error.Message
		}
	default:
		result.Status = model.TaskStatusInProgress
		result.Progress = progressString(task.Progress)
	}
	return result, nil
}

func progressString(progress int) string {
	if progress <= 0 {
		return taskcommon.ProgressInProgress
	}
	if progress >= 100 {
		return taskcommon.ProgressComplete
	}
	return fmt.Sprintf("%d%%", progress)
}

func (a *TaskAdaptor) ConvertToOpenAIVideo(task *model.Task) ([]byte, error) {
	data := task.Data
	var err error
	if data, err = sjson.SetBytes(data, "id", task.TaskID); err != nil {
		return nil, errors.Wrap(err, "set id failed")
	}
	if data, err = sjson.SetBytes(data, "task_id", task.TaskID); err != nil {
		return nil, errors.Wrap(err, "set task_id failed")
	}
	if task.UpdatedAt > 0 {
		data, _ = sjson.SetBytes(data, "completed_at", task.UpdatedAt)
	}
	if task.CreatedAt > 0 {
		data, _ = sjson.SetBytes(data, "created_at", task.CreatedAt)
	} else {
		data, _ = sjson.SetBytes(data, "created_at", time.Now().Unix())
	}
	return data, nil
}
