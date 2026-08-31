package doubao

import (
	"bytes"
	stderrors "errors"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"time"

	"github.com/QuantumNous/new-api/common"

	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/dto"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/relay/channel"
	"github.com/QuantumNous/new-api/relay/channel/task/taskcommon"
	"github.com/QuantumNous/new-api/relay/channel/volcengine"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	"github.com/QuantumNous/new-api/service"

	"github.com/gin-gonic/gin"
	"github.com/pkg/errors"
	"github.com/samber/lo"
)

// ============================
// Request / Response structures
// ============================

type ContentItem struct {
	Type     string    `json:"type,omitempty"`
	Text     string    `json:"text,omitempty"`
	ImageURL *MediaURL `json:"image_url,omitempty"`
	VideoURL *MediaURL `json:"video_url,omitempty"`
	AudioURL *MediaURL `json:"audio_url,omitempty"`
	Role     string    `json:"role,omitempty"`
}

type MediaURL struct {
	URL string `json:"url,omitempty"`
}

type requestPayload struct {
	Model                 string         `json:"model"`
	Content               []ContentItem  `json:"content,omitempty"`
	CallbackURL           string         `json:"callback_url,omitempty"`
	ReturnLastFrame       *dto.BoolValue `json:"return_last_frame,omitempty"`
	ServiceTier           string         `json:"service_tier,omitempty"`
	ExecutionExpiresAfter *dto.IntValue  `json:"execution_expires_after,omitempty"`
	GenerateAudio         *dto.BoolValue `json:"generate_audio,omitempty"`
	Draft                 *dto.BoolValue `json:"draft,omitempty"`
	Tools                 []struct {
		Type string `json:"type,omitempty"`
	} `json:"tools,omitempty"`
	Resolution  string         `json:"resolution,omitempty"`
	Ratio       string         `json:"ratio,omitempty"`
	Duration    *dto.IntValue  `json:"duration,omitempty"`
	Frames      *dto.IntValue  `json:"frames,omitempty"`
	Seed        *dto.IntValue  `json:"seed,omitempty"`
	CameraFixed *dto.BoolValue `json:"camera_fixed,omitempty"`
	Watermark   *dto.BoolValue `json:"watermark,omitempty"`
}

type responsePayload struct {
	ID string `json:"id"` // task_id
}

type responseTaskContent struct {
	VideoURL string `json:"video_url"` // video generation
	URL      string `json:"url"`       // 3d / generic
	ModelURL string `json:"model_url"` // 3d (alternative key)
}

// effectiveURL returns the first non-empty URL across all known content fields.
func (c responseTaskContent) effectiveURL() string {
	if c.VideoURL != "" {
		return c.VideoURL
	}
	if c.URL != "" {
		return c.URL
	}
	return c.ModelURL
}

type responseTask struct {
	ID              string              `json:"id"`
	Model           string              `json:"model"`
	Status          string              `json:"status"`
	Content         responseTaskContent `json:"content"`
	Seed            int                 `json:"seed"`
	Resolution      string              `json:"resolution"`
	Duration        int                 `json:"duration"`
	Ratio           string              `json:"ratio"`
	FramesPerSecond int                 `json:"framespersecond"`
	ServiceTier     string              `json:"service_tier"`
	Tools           []struct {
		Type string `json:"type"`
	} `json:"tools"`
	Usage struct {
		CompletionTokens int `json:"completion_tokens"`
		TotalTokens      int `json:"total_tokens"`
		ToolUsage        struct {
			WebSearch int `json:"web_search"`
		} `json:"tool_usage"`
	} `json:"usage"`
	Error struct {
		Code    string `json:"code"`
		Message string `json:"message"`
	} `json:"error"`
	CreatedAt int64 `json:"created_at"`
	UpdatedAt int64 `json:"updated_at"`
}

// ============================
// Adaptor implementation
// ============================

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

// ValidateRequestAndSetAction parses body, validates fields and sets default action.
// 命中「ARK 官渠 + Seedance 2.x 视频模型」时插入 ARK 素材审核闭环：
// 把图片、音频和视频 URL 预上传 ARK 审核并替换为 asset://<id>，拒绝/技术失败一律硬拦（不降级）。
// 在此处（预扣费之前、可控 HTTP 状态码）执行，故能区分 4xx(被拒) / 5xx(不可用)。
func (a *TaskAdaptor) ValidateRequestAndSetAction(c *gin.Context, info *relaycommon.RelayInfo) (taskErr *dto.TaskError) {
	if taskErr = relaycommon.ValidateBasicTaskRequest(c, info, constant.TaskActionGenerate); taskErr != nil {
		return taskErr
	}
	req, err := relaycommon.GetTaskRequest(c)
	if err != nil {
		return nil // 无已解析请求 → 无可审核内容
	}
	// Seedance 2.x 官渠：所有外部参考媒体必须先经 ARK 预上传成 asset://，否则上游
	// contents/generations/tasks 会对原始 URL 报 InvalidParameter "resource not found"。
	// 素材来自两条通道，都要审核：
	//   1) req.Images —— 纯图生视频 / 首尾帧路径；
	//   2) metadata.content 内嵌的 image_url / audio_url / video_url —— 参考媒体路径。
	if !volcengine.RequiresArkAssetUpload(a.ChannelType, req.Model) {
		return nil
	}
	wrapModerationErr := func(mErr error) *dto.TaskError {
		var me *volcengine.ArkModerationError
		if stderrors.As(mErr, &me) && me.Rejected {
			te := service.TaskErrorWrapperLocal(mErr, "ark_moderation_rejected", http.StatusBadRequest)
			// 带上被拒的原始媒体 URL，调用方可据此定位对应参考素材。
			if len(me.RejectedURLs) > 0 {
				te.Data = map[string]interface{}{"rejected_urls": me.RejectedURLs}
			}
			return te
		}
		return service.TaskErrorWrapperLocal(mErr, "ark_moderation_unavailable", http.StatusBadGateway)
	}
	mutated := false
	if req.HasImage() {
		converted, mErr := volcengine.ModerateSeedanceImages(req.Images)
		if mErr != nil {
			return wrapModerationErr(mErr)
		}
		req.Images = converted
		mutated = true
	}
	changed, mErr := moderateMetadataContentAssets(req.Metadata)
	if mErr != nil {
		return wrapModerationErr(mErr)
	}
	if changed {
		mutated = true
	}
	if mutated {
		relaycommon.SetTaskRequest(c, req)
	}
	return nil
}

type metadataAssetConverter func([]volcengine.SeedanceAssetInput) ([]string, error)

// moderateMetadataContentAssets 把 metadata.content 中的图片、音频和视频 URL 经 ARK
// 预上传为 asset:// 并原子回写。metadata 为 nil、无 content 或无媒体时是无操作。
func moderateMetadataContentAssets(metadata map[string]interface{}) (bool, error) {
	return rewriteMetadataContentAssets(metadata, volcengine.ModerateSeedanceAssets)
}

func rewriteMetadataContentAssets(metadata map[string]interface{}, convert metadataAssetConverter) (bool, error) {
	if metadata == nil {
		return false, nil
	}
	contentRaw, ok := metadata["content"]
	if !ok {
		return false, nil
	}
	contentSlice, ok := contentRaw.([]interface{})
	if !ok {
		return false, nil
	}
	type mediaRef struct {
		urlMap map[string]interface{}
	}
	var refs []mediaRef
	var inputs []volcengine.SeedanceAssetInput
	for _, item := range contentSlice {
		itemMap, ok := item.(map[string]interface{})
		if !ok {
			continue
		}
		contentType, ok := itemMap["type"].(string)
		if !ok {
			continue
		}
		var assetType volcengine.ArkAssetType
		switch contentType {
		case "image_url":
			assetType = volcengine.ArkAssetTypeImage
		case "video_url":
			assetType = volcengine.ArkAssetTypeVideo
		case "audio_url":
			assetType = volcengine.ArkAssetTypeAudio
		default:
			continue
		}
		urlMap, ok := itemMap[contentType].(map[string]interface{})
		if !ok {
			continue
		}
		u, ok := urlMap["url"].(string)
		if !ok || u == "" {
			continue
		}
		refs = append(refs, mediaRef{urlMap: urlMap})
		inputs = append(inputs, volcengine.SeedanceAssetInput{URL: u, Type: assetType})
	}
	if len(inputs) == 0 {
		return false, nil
	}
	converted, err := convert(inputs)
	if err != nil {
		return false, err
	}
	if len(converted) != len(refs) {
		return false, fmt.Errorf("ARK asset conversion returned %d results for %d inputs", len(converted), len(refs))
	}
	for i := range refs {
		refs[i].urlMap["url"] = converted[i]
	}
	return true, nil
}

// BuildRequestURL constructs the upstream URL.
func (a *TaskAdaptor) BuildRequestURL(_ *relaycommon.RelayInfo) (string, error) {
	return fmt.Sprintf("%s/api/v3/contents/generations/tasks", a.baseURL), nil
}

// BuildRequestHeader sets required headers.
func (a *TaskAdaptor) BuildRequestHeader(_ *gin.Context, req *http.Request, _ *relaycommon.RelayInfo) error {
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json")
	req.Header.Set("Authorization", "Bearer "+a.apiKey)
	return nil
}

// 上游 ARK seedance 未显式传参时的默认规格（用于计费估算，与上游默认值一致）。
const (
	defaultBillingResolution      = "720p"
	defaultBillingDurationSeconds = 5
)

// EstimateBilling 按 (分辨率 × 时长) 规格价折算计费倍率：spec_price = 规格价 / 基础模型价。
// 规格价与 /api/pricing 发布给下游（画布积分定价）的是同一张表，保证「用户实际花费」
// 与 new-api 扣减一致，而不是任意时长/规格都扣固定基础价。
// 模型没有规格价表时回退到旧的视频输入折扣逻辑。
func (a *TaskAdaptor) EstimateBilling(c *gin.Context, info *relaycommon.RelayInfo) map[string]float64 {
	req, err := relaycommon.GetTaskRequest(c)
	if err != nil {
		return nil
	}
	if payload, perr := a.convertToRequestPayload(&req); perr == nil && info.PriceData.ModelPrice > 0 {
		resolution := payload.Resolution
		if resolution == "" {
			resolution = defaultBillingResolution
		}
		duration := defaultBillingDurationSeconds
		if payload.Duration != nil && int(*payload.Duration) > 0 {
			duration = int(*payload.Duration)
		}
		_, billableDuration := taskcommon.ResolveTaskVideoBillingSpec(&req)
		if billableDuration > 0 {
			duration = billableDuration
		}
		if price, ok := model.VideoSpecPriceCNY(info.OriginModelName, resolution, duration); ok && price > 0 {
			return map[string]float64{"spec_price": price / info.PriceData.ModelPrice}
		}
	}
	if hasVideoInMetadata(req.Metadata) {
		if ratio, ok := GetVideoInputRatio(info.OriginModelName); ok {
			return map[string]float64{"video_input": ratio}
		}
	}
	return nil
}

// hasVideoInMetadata 直接检查 metadata 的 content 数组是否包含 video_url 条目，
// 避免构建完整的上游 requestPayload。
func hasVideoInMetadata(metadata map[string]interface{}) bool {
	if metadata == nil {
		return false
	}
	contentRaw, ok := metadata["content"]
	if !ok {
		return false
	}
	contentSlice, ok := contentRaw.([]interface{})
	if !ok {
		return false
	}
	for _, item := range contentSlice {
		itemMap, ok := item.(map[string]interface{})
		if !ok {
			continue
		}
		if itemMap["type"] == "video_url" {
			return true
		}
		if _, has := itemMap["video_url"]; has {
			return true
		}
	}
	return false
}

// BuildRequestBody converts request into Doubao specific format.
func (a *TaskAdaptor) BuildRequestBody(c *gin.Context, info *relaycommon.RelayInfo) (io.Reader, error) {
	req, err := relaycommon.GetTaskRequest(c)
	if err != nil {
		return nil, err
	}

	body, err := a.convertToRequestPayload(&req)
	if err != nil {
		return nil, errors.Wrap(err, "convert request payload failed")
	}
	if info.IsModelMapped {
		body.Model = info.UpstreamModelName
	} else {
		info.UpstreamModelName = body.Model
	}
	data, err := common.Marshal(body)
	if err != nil {
		return nil, err
	}
	return bytes.NewReader(data), nil
}

// DoRequest delegates to common helper.
func (a *TaskAdaptor) DoRequest(c *gin.Context, info *relaycommon.RelayInfo, requestBody io.Reader) (*http.Response, error) {
	return channel.DoTaskApiRequest(a, c, info, requestBody)
}

// DoResponse handles upstream response, returns taskID etc.
func (a *TaskAdaptor) DoResponse(c *gin.Context, resp *http.Response, info *relaycommon.RelayInfo) (taskID string, taskData []byte, taskErr *dto.TaskError) {
	responseBody, err := io.ReadAll(resp.Body)
	if err != nil {
		taskErr = service.TaskErrorWrapper(err, "read_response_body_failed", http.StatusInternalServerError)
		return
	}
	_ = resp.Body.Close()

	// Parse Doubao response
	var dResp responsePayload
	if err := common.Unmarshal(responseBody, &dResp); err != nil {
		taskErr = service.TaskErrorWrapper(errors.Wrapf(err, "body: %s", responseBody), "unmarshal_response_body_failed", http.StatusInternalServerError)
		return
	}

	if dResp.ID == "" {
		taskErr = service.TaskErrorWrapper(fmt.Errorf("task_id is empty"), "invalid_response", http.StatusInternalServerError)
		return
	}

	ov := dto.NewOpenAIVideo()
	ov.ID = info.PublicTaskID
	ov.TaskID = info.PublicTaskID
	ov.CreatedAt = time.Now().Unix()
	ov.Model = info.OriginModelName

	c.JSON(http.StatusOK, ov)
	return dResp.ID, responseBody, nil
}

// FetchTask fetch task status
func (a *TaskAdaptor) FetchTask(baseUrl, key string, body map[string]any, proxy string) (*http.Response, error) {
	taskID, ok := body["task_id"].(string)
	if !ok {
		return nil, fmt.Errorf("invalid task_id")
	}

	uri := fmt.Sprintf("%s/api/v3/contents/generations/tasks/%s", baseUrl, taskID)

	req, err := http.NewRequest(http.MethodGet, uri, nil)
	if err != nil {
		return nil, err
	}

	req.Header.Set("Accept", "application/json")
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+key)

	client, err := service.GetHttpClientWithProxy(proxy)
	if err != nil {
		return nil, fmt.Errorf("new proxy http client failed: %w", err)
	}
	return client.Do(req)
}

func (a *TaskAdaptor) GetModelList() []string {
	return ModelList
}

func (a *TaskAdaptor) GetChannelName() string {
	return ChannelName
}

func (a *TaskAdaptor) convertToRequestPayload(req *relaycommon.TaskSubmitReq) (*requestPayload, error) {
	r := requestPayload{
		Model:   req.Model,
		Content: []ContentItem{},
	}

	// Add images if present. ARK seedance 的 contents/generations/tasks 接口要求每张
	// 参考图都用 role="reference_image"（与上游官方/参考实现一致）；首帧语义由 prompt
	// 文本表达（如「图1为首帧图」），而不是用 role=first_frame。早期用 first_frame +
	// 其余无 role 的写法会被上游按错误格式处理（asset/参考图无法解析）。
	if req.HasImage() {
		for _, imgURL := range req.Images {
			r.Content = append(r.Content, ContentItem{
				Type: "image_url",
				Role: "reference_image",
				ImageURL: &MediaURL{
					URL: imgURL,
				},
			})
		}
	}

	metadata := req.Metadata
	if err := taskcommon.UnmarshalMetadata(metadata, &r); err != nil {
		return nil, errors.Wrap(err, "unmarshal metadata failed")
	}

	// 参考媒体模式（含参考视频/运动迁移）：hono 经 metadata.content 传入的 video_url / image_url
	// 默认无 role，上游 seedance 会报 "reference media mode requires video role to be
	// reference_video"，且把无 role 的图片当作 first/last frame、与参考视频冲突
	// ("first/last frame cannot be mixed with reference media")。这里统一补 role：
	//   - video_url → reference_video
	//   - image_url → reference_image（仅当本批存在参考视频时，避免影响纯首尾帧流程）
	hasReferenceVideo := false
	for i := range r.Content {
		if r.Content[i].Type == "video_url" && r.Content[i].VideoURL != nil {
			hasReferenceVideo = true
			break
		}
	}
	for i := range r.Content {
		if r.Content[i].Role != "" {
			continue
		}
		if r.Content[i].Type == "video_url" && r.Content[i].VideoURL != nil {
			r.Content[i].Role = "reference_video"
		} else if hasReferenceVideo && r.Content[i].Type == "image_url" && r.Content[i].ImageURL != nil {
			r.Content[i].Role = "reference_image"
		}
	}

	// 时长：hono-api 透传的是 req.Duration(int)；兼容旧的 req.Seconds(string)。
	// metadata 已有 Duration 时不覆盖。
	if r.Duration == nil {
		if req.Duration > 0 {
			r.Duration = lo.ToPtr(dto.IntValue(req.Duration))
		} else if sec, _ := strconv.Atoi(req.Seconds); sec > 0 {
			r.Duration = lo.ToPtr(dto.IntValue(sec))
		}
	}
	// 分辨率/画幅透传（metadata 未覆盖时取顶层字段）。
	if r.Resolution == "" && req.Resolution != "" {
		r.Resolution = req.Resolution
	}
	if r.Ratio == "" && req.AspectRatio != "" {
		r.Ratio = req.AspectRatio
	}

	r.Content = lo.Reject(r.Content, func(c ContentItem, _ int) bool { return c.Type == "text" })
	r.Content = append(r.Content, ContentItem{
		Type: "text",
		Text: req.Prompt,
	})

	return &r, nil
}

func (a *TaskAdaptor) ParseTaskResult(respBody []byte) (*relaycommon.TaskInfo, error) {
	resTask := responseTask{}
	if err := common.Unmarshal(respBody, &resTask); err != nil {
		return nil, errors.Wrap(err, "unmarshal task result failed")
	}

	taskResult := relaycommon.TaskInfo{
		Code: 0,
	}

	// Map Doubao status to internal status
	switch resTask.Status {
	case "pending", "queued":
		taskResult.Status = model.TaskStatusQueued
		taskResult.Progress = "10%"
	case "processing", "running":
		taskResult.Status = model.TaskStatusInProgress
		taskResult.Progress = "50%"
	case "succeeded":
		taskResult.Status = model.TaskStatusSuccess
		taskResult.Progress = "100%"
		taskResult.Url = resTask.Content.effectiveURL()
		// 解析 usage 信息用于按倍率计费
		taskResult.CompletionTokens = resTask.Usage.CompletionTokens
		taskResult.TotalTokens = resTask.Usage.TotalTokens
	case "failed":
		taskResult.Status = model.TaskStatusFailure
		taskResult.Progress = "100%"
		taskResult.Reason = resTask.Error.Message
	default:
		// Unknown status, treat as processing
		taskResult.Status = model.TaskStatusInProgress
		taskResult.Progress = "30%"
	}

	return &taskResult, nil
}

func (a *TaskAdaptor) ConvertToOpenAIVideo(originTask *model.Task) ([]byte, error) {
	var dResp responseTask
	if err := common.Unmarshal(originTask.Data, &dResp); err != nil {
		return nil, errors.Wrap(err, "unmarshal doubao task data failed")
	}

	openAIVideo := dto.NewOpenAIVideo()
	openAIVideo.ID = originTask.TaskID
	openAIVideo.TaskID = originTask.TaskID
	openAIVideo.Status = originTask.Status.ToVideoStatus()
	openAIVideo.SetProgressStr(originTask.Progress)
	openAIVideo.SetMetadata("url", dResp.Content.effectiveURL())
	openAIVideo.CreatedAt = originTask.CreatedAt
	openAIVideo.CompletedAt = originTask.UpdatedAt
	openAIVideo.Model = originTask.Properties.OriginModelName

	if dResp.Status == "failed" {
		openAIVideo.Error = &dto.OpenAIVideoError{
			Message: dResp.Error.Message,
			Code:    dResp.Error.Code,
		}
	}

	return common.Marshal(openAIVideo)
}
