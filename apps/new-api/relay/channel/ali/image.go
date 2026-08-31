package ali

import (
	"encoding/base64"
	"errors"
	"fmt"
	"io"
	"mime/multipart"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/dto"
	"github.com/QuantumNous/new-api/logger"
	"github.com/QuantumNous/new-api/relay/channel/imageutil"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	"github.com/QuantumNous/new-api/service"
	"github.com/QuantumNous/new-api/types"

	"github.com/gin-gonic/gin"
	"github.com/samber/lo"
)

func oaiImage2AliImageRequest(info *relaycommon.RelayInfo, request dto.ImageRequest, isSync bool) (*AliImageRequest, error) {
	var imageRequest AliImageRequest
	imageRequest.Model = request.Model
	imageRequest.ResponseFormat = request.ResponseFormat
	if request.Extra != nil {
		if val, ok := request.Extra["parameters"]; ok {
			err := common.Unmarshal(val, &imageRequest.Parameters)
			if err != nil {
				return nil, fmt.Errorf("invalid parameters field: %w", err)
			}
		} else {
			// 兼容没有parameters字段的情况，从openai标准字段中提取参数。
			// 比例优先取标准 size，缺省回退 Extra["aspect_ratio"]（与 apimart 渠道一致）。
			ratio := request.Size
			if ratio == "" {
				if raw, ok := request.Extra["aspect_ratio"]; ok && len(raw) > 0 {
					var ar string
					if err := common.Unmarshal(raw, &ar); err == nil {
						ratio = strings.TrimSpace(ar)
					}
				}
			}
			// 分辨率档位 1K/2K：优先 Extra["resolution"]，回退 image_size/imageSize。
			resolution := ""
			if raw, ok := request.Extra["resolution"]; ok && len(raw) > 0 {
				var res string
				if err := common.Unmarshal(raw, &res); err == nil {
					resolution = strings.TrimSpace(res)
				}
			}
			if resolution == "" {
				resolution = imageutil.ExtractRequestedImageSize(&request)
			}
			convertedSize, err := convertAliImageSize(ratio, resolution)
			if err != nil {
				return nil, err
			}
			imageRequest.Parameters = AliImageParameters{
				Size:      convertedSize,
				N:         int(lo.FromPtrOr(request.N, uint(1))),
				Watermark: request.Watermark,
			}
		}
		if val, ok := request.Extra["input"]; ok {
			err := common.Unmarshal(val, &imageRequest.Input)
			if err != nil {
				return nil, fmt.Errorf("invalid input field: %w", err)
			}
		}
	}

	if strings.Contains(request.Model, "z-image") {
		// z-image 开启prompt_extend后，按2倍计费
		if imageRequest.Parameters.PromptExtendValue() {
			info.PriceData.AddOtherRatio("prompt_extend", 2)
		}
	}

	if imageRequest.Parameters.N != 0 {
		info.PriceData.AddOtherRatio("n", float64(imageRequest.Parameters.N))
	}

	// 同步图片模型和异步图片模型请求格式不一样
	if isSync {
		if imageRequest.Input == nil {
			// 图像编辑模型（qwen-image-edit 等）要求 content 里带 1~3 张输入图，否则上游报
			// "For image editing, the message must contain 1~3 image content items. Got 0 image items"。
			content := make([]AliMediaContent, 0, 2)
			for _, imgURL := range imageutil.ExtractReferenceImages(&request) {
				if ref := aliInlineImageRef(imgURL); ref != "" {
					content = append(content, AliMediaContent{Image: ref})
				}
			}
			content = append(content, AliMediaContent{Text: request.Prompt})
			imageRequest.Input = AliImageInput{
				Messages: []AliMessage{
					{
						Role:    "user",
						Content: content,
					},
				},
			}
		}
	} else {
		if imageRequest.Input == nil {
			imageRequest.Input = AliImageInput{
				Prompt: request.Prompt,
			}
		}
	}

	return &imageRequest, nil
}

// aliInlineImageRef 把参考图归一化成可直接发给 DashScope multimodal-generation 的 image 值。
//
// 背景：DashScope 的抓图服务器在中国大陆，去下载 Cloudflare 前置的外链（如 R2 公开域名）
// 经常失败（bot 挑战/国家策略/GFW/大图超时），报 "Failed to download image from [...]"。
// new-api 自身能正常访问这些域名，因此对 http(s) 外链先在本地下载、内联成 base64 data URL，
// 绕开上游抓取。data:/base64 原样透传；下载失败则回退原 URL（不比之前更差，仍让上游尝试）。
func aliInlineImageRef(ref string) string {
	ref = strings.TrimSpace(ref)
	if ref == "" {
		return ""
	}
	if strings.HasPrefix(ref, "data:") {
		return ref
	}
	if strings.HasPrefix(ref, "http://") || strings.HasPrefix(ref, "https://") {
		mimeType, b64, err := service.GetImageFromUrl(ref)
		if err != nil {
			common.SysLog(fmt.Sprintf("ali: inline reference image failed, fallback to url: %s, err: %v", common.MaskSensitiveInfo(ref), err))
			return ref
		}
		return fmt.Sprintf("data:%s;base64,%s", mimeType, b64)
	}
	return ref
}

// DashScope qwen-image / qwen-image-edit 系列 size 官方约束
// （见 https://help.aliyun.com/zh/model-studio/qwen-image-edit-guide）：
//   - 宽、高各自取值范围 [512, 2048]；
//   - 输出图像总像素需在 512*512 ~ 2048*2048 之间。
const (
	aliImageMinSide   = 512
	aliImageMaxSide   = 2048
	aliImageMinPixels = aliImageMinSide * aliImageMinSide
	aliImageMaxPixels = aliImageMaxSide * aliImageMaxSide
)

// normalizeAliResolution 归一化分辨率档位为 "1K"/"2K"；空值默认 "2K"
// （与前端 imageOptions.defaultImageSize 对齐）。4K 等 DashScope 不支持的档位回退 2K。
func normalizeAliResolution(res string) string {
	switch strings.ToUpper(strings.TrimSpace(res)) {
	case "1K":
		return "1K"
	default:
		return "2K"
	}
}

// aliRatioPixels 按 (宽高比, 分辨率档) 映射 DashScope 可用像素。数值取 qwen-image 家族
// 通用 1K/2K 档位，全部落在 DashScope 单边 [512,2048]、总像素 ≤2048*2048 约束内。
var aliRatioPixels = map[string]map[string]string{
	"1:1":  {"1K": "1024*1024", "2K": "2048*2048"},
	"16:9": {"1K": "1280*720", "2K": "2048*1152"},
	"9:16": {"1K": "720*1280", "2K": "1152*2048"},
	"4:3":  {"1K": "1152*864", "2K": "2048*1536"},
	"3:4":  {"1K": "864*1152", "2K": "1536*2048"},
	"3:2":  {"1K": "1248*832", "2K": "2048*1360"},
	"2:3":  {"1K": "832*1248", "2K": "1360*2048"},
}

// aliRatioSingleTier 是 DashScope 额外支持、但无 1K/2K 双档的超宽比例
// （前端 qwen-image 比例下拉不暴露，仅直连 API 调用时用）。
var aliRatioSingleTier = map[string]string{
	"21:9": "1792*768",
	"9:21": "768*1792",
}

// convertAliImageSize 把请求里的尺寸转换成 DashScope 要求的 "width*height" 格式，并按官方约束校验。
//   - 宽高比形态（如 "16:9"）按分辨率档(1K/2K，默认2K)映射为对应像素；超宽比(21:9/9:21)为单档；
//   - "1024x1024" / "1024*1024" 形态解析后校验宽高与总像素范围，越界返回错误；
//   - 空或未知比例返回 ""（空时上游按模型默认/原图比例处理，edit 系列约 1024*1024）。
func convertAliImageSize(size, resolution string) (string, error) {
	s := strings.TrimSpace(size)
	if s == "" {
		return "", nil
	}
	if strings.Contains(s, ":") {
		if tier, ok := aliRatioPixels[s]; ok {
			return tier[normalizeAliResolution(resolution)], nil
		}
		if px, ok := aliRatioSingleTier[s]; ok {
			return px, nil
		}
		// 未知比例：不强行传尺寸，交给上游按默认/原图比例处理。
		return "", nil
	}

	// 显式宽高：归一化 "宽x高"/"宽*高" 后按官方范围校验
	norm := strings.NewReplacer("x", "*", "X", "*").Replace(s)
	parts := strings.Split(norm, "*")
	if len(parts) != 2 {
		// 非 宽*高 形态，原样透传给上游判定（保持旧行为，不擅自拒绝）。
		return norm, nil
	}
	w, errW := strconv.Atoi(strings.TrimSpace(parts[0]))
	h, errH := strconv.Atoi(strings.TrimSpace(parts[1]))
	if errW != nil || errH != nil {
		return "", fmt.Errorf("invalid size %q: expected \"width*height\"", size)
	}
	if w < aliImageMinSide || w > aliImageMaxSide || h < aliImageMinSide || h > aliImageMaxSide {
		return "", fmt.Errorf("invalid size %dx%d: width/height must be within [%d, %d]", w, h, aliImageMinSide, aliImageMaxSide)
	}
	if px := w * h; px < aliImageMinPixels || px > aliImageMaxPixels {
		return "", fmt.Errorf("invalid size %dx%d: total pixels must be within [%d*%d, %d*%d]", w, h, aliImageMinSide, aliImageMinSide, aliImageMaxSide, aliImageMaxSide)
	}
	return fmt.Sprintf("%d*%d", w, h), nil
}

func getImageBase64sFromForm(c *gin.Context, fieldName string) ([]string, error) {
	mf := c.Request.MultipartForm
	if mf == nil {
		if _, err := c.MultipartForm(); err != nil {
			return nil, fmt.Errorf("failed to parse image edit form request: %w", err)
		}
		mf = c.Request.MultipartForm
	}

	var imageFiles []*multipart.FileHeader
	var exists bool

	// First check for standard "image" field
	if imageFiles, exists = mf.File["image"]; !exists || len(imageFiles) == 0 {
		// If not found, check for "image[]" field
		if imageFiles, exists = mf.File["image[]"]; !exists || len(imageFiles) == 0 {
			// If still not found, iterate through all fields to find any that start with "image["
			foundArrayImages := false
			for fieldName, files := range mf.File {
				if strings.HasPrefix(fieldName, "image[") && len(files) > 0 {
					foundArrayImages = true
					imageFiles = append(imageFiles, files...)
				}
			}

			// If no image fields found at all
			if !foundArrayImages && (len(imageFiles) == 0) {
				return nil, errors.New("image is required")
			}
		}
	}

	if len(imageFiles) == 0 {
		return nil, errors.New("image is required")
	}

	//if len(imageFiles) > 1 {
	//	return nil, errors.New("only one image is supported for qwen edit")
	//}

	// 获取base64编码的图片
	var imageBase64s []string
	for _, file := range imageFiles {
		image, err := file.Open()
		if err != nil {
			return nil, errors.New("failed to open image file")
		}

		// 读取文件内容
		imageData, err := io.ReadAll(image)
		if err != nil {
			return nil, errors.New("failed to read image file")
		}

		// 获取MIME类型
		mimeType := http.DetectContentType(imageData)

		// 编码为base64
		base64Data := base64.StdEncoding.EncodeToString(imageData)

		// 构造data URL格式
		dataURL := fmt.Sprintf("data:%s;base64,%s", mimeType, base64Data)
		imageBase64s = append(imageBase64s, dataURL)
		image.Close()
	}
	return imageBase64s, nil
}

func oaiFormEdit2AliImageEdit(c *gin.Context, info *relaycommon.RelayInfo, request dto.ImageRequest) (*AliImageRequest, error) {
	var imageRequest AliImageRequest
	imageRequest.Model = request.Model
	imageRequest.ResponseFormat = request.ResponseFormat

	imageBase64s, err := getImageBase64sFromForm(c, "image")
	if err != nil {
		return nil, fmt.Errorf("get image base64s from form failed: %w", err)
	}
	//dto.MediaContent{}
	mediaContents := make([]AliMediaContent, len(imageBase64s))
	for i, b64 := range imageBase64s {
		mediaContents[i] = AliMediaContent{
			Image: b64,
		}
	}
	mediaContents = append(mediaContents, AliMediaContent{
		Text: request.Prompt,
	})
	imageRequest.Input = AliImageInput{
		Messages: []AliMessage{
			{
				Role:    "user",
				Content: mediaContents,
			},
		},
	}
	imageRequest.Parameters = AliImageParameters{
		N:         int(lo.FromPtrOr(request.N, uint(1))),
		Watermark: request.Watermark,
	}
	return &imageRequest, nil
}

func updateTask(info *relaycommon.RelayInfo, taskID string) (*AliResponse, error, []byte) {
	url := fmt.Sprintf("%s/api/v1/tasks/%s", info.ChannelBaseUrl, taskID)

	var aliResponse AliResponse

	req, err := http.NewRequest("GET", url, nil)
	if err != nil {
		return &aliResponse, err, nil
	}

	req.Header.Set("Authorization", "Bearer "+info.ApiKey)

	client := &http.Client{}
	resp, err := client.Do(req)
	if err != nil {
		common.SysLog("updateTask client.Do err: " + err.Error())
		return &aliResponse, err, nil
	}
	defer resp.Body.Close()

	responseBody, err := io.ReadAll(resp.Body)

	var response AliResponse
	err = common.Unmarshal(responseBody, &response)
	if err != nil {
		common.SysLog("updateTask NewDecoder err: " + err.Error())
		return &aliResponse, err, nil
	}

	return &response, nil, responseBody
}

func asyncTaskWait(c *gin.Context, info *relaycommon.RelayInfo, taskID string) (*AliResponse, []byte, error) {
	waitSeconds := 10
	step := 0
	maxStep := 20

	var taskResponse AliResponse
	var responseBody []byte

	time.Sleep(time.Duration(5) * time.Second)

	for {
		logger.LogDebug(c, fmt.Sprintf("asyncTaskWait step %d/%d, wait %d seconds", step, maxStep, waitSeconds))
		step++
		rsp, err, body := updateTask(info, taskID)
		responseBody = body
		if err != nil {
			logger.LogWarn(c, "asyncTaskWait UpdateTask err: "+err.Error())
			time.Sleep(time.Duration(waitSeconds) * time.Second)
			continue
		}

		if rsp.Output.TaskStatus == "" {
			return &taskResponse, responseBody, nil
		}

		switch rsp.Output.TaskStatus {
		case "FAILED":
			fallthrough
		case "CANCELED":
			fallthrough
		case "SUCCEEDED":
			fallthrough
		case "UNKNOWN":
			return rsp, responseBody, nil
		}
		if step >= maxStep {
			break
		}
		time.Sleep(time.Duration(waitSeconds) * time.Second)
	}

	return nil, nil, fmt.Errorf("aliAsyncTaskWait timeout")
}

func responseAli2OpenAIImage(c *gin.Context, response *AliResponse, originBody []byte, info *relaycommon.RelayInfo, responseFormat string) *dto.ImageResponse {
	imageResponse := dto.ImageResponse{
		Created: info.StartTime.Unix(),
	}

	if len(response.Output.Results) > 0 {
		imageResponse.Data = response.Output.ResultToOpenAIImageDate(c, responseFormat)
	} else if len(response.Output.Choices) > 0 {
		imageResponse.Data = response.Output.ChoicesToOpenAIImageDate(c, responseFormat)
	}

	imageResponse.Metadata = originBody
	return &imageResponse
}

func aliImageHandler(a *Adaptor, c *gin.Context, resp *http.Response, info *relaycommon.RelayInfo) (*types.NewAPIError, *dto.Usage) {
	responseFormat := c.GetString("response_format")

	var aliTaskResponse AliResponse
	responseBody, err := io.ReadAll(resp.Body)
	if err != nil {
		return types.NewOpenAIError(err, types.ErrorCodeReadResponseBodyFailed, http.StatusInternalServerError), nil
	}
	service.CloseResponseBodyGracefully(resp)
	err = common.Unmarshal(responseBody, &aliTaskResponse)
	if err != nil {
		return types.NewOpenAIError(err, types.ErrorCodeBadResponseBody, http.StatusInternalServerError), nil
	}

	if aliTaskResponse.Message != "" {
		logger.LogError(c, "ali_async_task_failed: "+aliTaskResponse.Message)
		return types.NewError(errors.New(aliTaskResponse.Message), types.ErrorCodeBadResponse), nil
	}

	var (
		aliResponse    *AliResponse
		originRespBody []byte
	)

	if a.IsSyncImageModel {
		aliResponse = &aliTaskResponse
		originRespBody = responseBody
	} else {
		// 异步图片模型需要轮询任务结果
		aliResponse, originRespBody, err = asyncTaskWait(c, info, aliTaskResponse.Output.TaskId)
		if err != nil {
			return types.NewError(err, types.ErrorCodeBadResponse), nil
		}
		if aliResponse.Output.TaskStatus != "SUCCEEDED" {
			return types.WithOpenAIError(types.OpenAIError{
				Message: aliResponse.Output.Message,
				Type:    "ali_error",
				Param:   "",
				Code:    aliResponse.Output.Code,
			}, resp.StatusCode), nil
		}
	}

	//logger.LogDebug(c, "ali_async_task_result: "+string(originRespBody))
	if a.IsSyncImageModel {
		logger.LogDebug(c, "ali_sync_image_result: "+string(originRespBody))
	} else {
		logger.LogDebug(c, "ali_async_image_result: "+string(originRespBody))
	}

	imageResponses := responseAli2OpenAIImage(c, aliResponse, originRespBody, info, responseFormat)
	if aliResponse.Usage.ImageCount != 0 {
		info.PriceData.AddOtherRatio("n", float64(aliResponse.Usage.ImageCount))
	} else if len(imageResponses.Data) != 0 {
		info.PriceData.AddOtherRatio("n", float64(len(imageResponses.Data)))
	}
	jsonResponse, err := common.Marshal(imageResponses)
	if err != nil {
		return types.NewError(err, types.ErrorCodeBadResponseBody), nil
	}
	service.IOCopyBytesGracefully(c, resp, jsonResponse)

	return nil, &dto.Usage{}
}
