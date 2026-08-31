package tencent

import (
	"errors"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/dto"
	"github.com/QuantumNous/new-api/relay/channel"
	"github.com/QuantumNous/new-api/relay/channel/imageutil"
	relaycommon "github.com/QuantumNous/new-api/relay/common"

	"github.com/gin-gonic/gin"
	"github.com/QuantumNous/new-api/types"
)

type Adaptor struct {
	Sign      string
	AppID     int64
	Action    string
	Version   string
	Timestamp int64

	// image generation via Tencent VOD AIGC (populated by ConvertImageRequest)
	pendingImageReq *vodCreateImageTaskReq
	imageSecretId   string
	imageSecretKey  string
	imageSubAppId   int64
}

func (a *Adaptor) ConvertGeminiRequest(*gin.Context, *relaycommon.RelayInfo, *dto.GeminiChatRequest) (any, error) {
	//TODO implement me
	return nil, errors.New("not implemented")
}

func (a *Adaptor) ConvertClaudeRequest(*gin.Context, *relaycommon.RelayInfo, *dto.ClaudeRequest) (any, error) {
	//TODO implement me
	panic("implement me")
	return nil, nil
}

func (a *Adaptor) ConvertAudioRequest(c *gin.Context, info *relaycommon.RelayInfo, request dto.AudioRequest) (io.Reader, error) {
	//TODO implement me
	return nil, errors.New("not implemented")
}

func (a *Adaptor) ConvertImageRequest(c *gin.Context, info *relaycommon.RelayInfo, request dto.ImageRequest) (any, error) {
	if request.N != nil && *request.N > 1 {
		return nil, fmt.Errorf("tencent image: n=%d is unsupported; this channel returns exactly one image per request", *request.N)
	}

	apiKey := common.GetContextKeyString(c, constant.ContextKeyChannelKey)
	apiKey = strings.TrimPrefix(apiKey, "Bearer ")

	subAppId, secretId, secretKey, err := parseTencentConfig(apiKey)
	if err != nil {
		return nil, fmt.Errorf("tencent image: invalid channel key: %w", err)
	}

	// quality is a first-class ImageRequest field. Resolution controls only the
	// output dimensions and must never promote the requested quality tier.
	quality := strings.TrimSpace(request.Quality)
	resolution := imageutil.ExtractRequestedImageSize(&request)
	// 按请求模型名选择腾讯 ModelName/ModelVersion：gemini→GEM，gpt-image-2→OG。
	// 优先用映射后的上游模型名，回退到客户端请求的 model。
	reqModel := strings.TrimSpace(info.UpstreamModelName)
	if reqModel == "" {
		reqModel = request.Model
	}
	modelName, modelVersion := resolveTencentImageModel(reqModel, quality, resolution)

	// Collect all supported reference-image field aliases through the shared
	// request contract used by the other image adaptors.
	imageURLs := imageutil.ExtractReferenceImages(&request)
	fileInfos := toVodFileInfos(imageURLs)

	outCfg := vodImageOutputConfig{StorageMode: "Temporary"}
	if request.Size != "" && request.Size != "1024x1024" {
		outCfg.AspectRatio = request.Size
	}
	if resolution != "" {
		outCfg.Resolution = strings.ToUpper(resolution)
	}

	a.imageSecretId = secretId
	a.imageSecretKey = secretKey
	a.imageSubAppId = subAppId
	a.pendingImageReq = &vodCreateImageTaskReq{
		ModelName:     modelName,
		ModelVersion:  modelVersion,
		SubAppId:      subAppId,
		EnhancePrompt: "Enabled",
		OutputConfig:  outCfg,
		Prompt:        request.Prompt,
		FileInfos:     fileInfos,
	}
	return a.pendingImageReq, nil
}

func (a *Adaptor) Init(info *relaycommon.RelayInfo) {
	a.Action = "ChatCompletions"
	a.Version = "2023-09-01"
	a.Timestamp = common.GetTimestamp()
}

func (a *Adaptor) GetRequestURL(info *relaycommon.RelayInfo) (string, error) {
	return fmt.Sprintf("%s/", info.ChannelBaseUrl), nil
}

func (a *Adaptor) SetupRequestHeader(c *gin.Context, req *http.Header, info *relaycommon.RelayInfo) error {
	channel.SetupApiRequestHeader(info, c, req)
	req.Set("Authorization", a.Sign)
	req.Set("X-TC-Action", a.Action)
	req.Set("X-TC-Version", a.Version)
	req.Set("X-TC-Timestamp", strconv.FormatInt(a.Timestamp, 10))
	return nil
}

func (a *Adaptor) ConvertOpenAIRequest(c *gin.Context, info *relaycommon.RelayInfo, request *dto.GeneralOpenAIRequest) (any, error) {
	if request == nil {
		return nil, errors.New("request is nil")
	}
	apiKey := common.GetContextKeyString(c, constant.ContextKeyChannelKey)
	apiKey = strings.TrimPrefix(apiKey, "Bearer ")
	appId, secretId, secretKey, err := parseTencentConfig(apiKey)
	a.AppID = appId
	if err != nil {
		return nil, err
	}
	tencentRequest := requestOpenAI2Tencent(a, *request)
	// we have to calculate the sign here
	a.Sign = getTencentSign(*tencentRequest, a, secretId, secretKey)
	return tencentRequest, nil
}

func (a *Adaptor) ConvertRerankRequest(c *gin.Context, relayMode int, request dto.RerankRequest) (any, error) {
	return nil, nil
}

func (a *Adaptor) ConvertEmbeddingRequest(c *gin.Context, info *relaycommon.RelayInfo, request dto.EmbeddingRequest) (any, error) {
	//TODO implement me
	return nil, errors.New("not implemented")
}

func (a *Adaptor) ConvertOpenAIResponsesRequest(c *gin.Context, info *relaycommon.RelayInfo, request dto.OpenAIResponsesRequest) (any, error) {
	// TODO implement me
	return nil, errors.New("not implemented")
}

func (a *Adaptor) DoRequest(c *gin.Context, info *relaycommon.RelayInfo, requestBody io.Reader) (any, error) {
	if a.pendingImageReq != nil {
		taskId, err := createVodImageTask(a.imageSecretId, a.imageSecretKey, a.imageSubAppId, *a.pendingImageReq)
		if err != nil {
			return nil, fmt.Errorf("Tencent VOD CreateAigcImageTask: %w", err)
		}

		imageURL, err := pollVodImageTask(a.imageSecretId, a.imageSecretKey, a.imageSubAppId, taskId, 15*time.Minute)
		if err != nil {
			return nil, fmt.Errorf("Tencent VOD image polling (taskId=%s): %w", taskId, err)
		}

		body := buildOpenAIImageResponseBody(imageURL, taskId)
		return &http.Response{
			StatusCode: http.StatusOK,
			Body:       io.NopCloser(strings.NewReader(body)),
			Header:     http.Header{"Content-Type": []string{"application/json"}},
		}, nil
	}
	return channel.DoApiRequest(a, c, info, requestBody)
}

func (a *Adaptor) DoResponse(c *gin.Context, resp *http.Response, info *relaycommon.RelayInfo) (usage any, err *types.NewAPIError) {
	if a.pendingImageReq != nil {
		return tencentImageResponseHandler(c, resp)
	}
	if info.IsStream {
		usage, err = tencentStreamHandler(c, info, resp)
	} else {
		usage, err = tencentHandler(c, info, resp)
	}
	return
}

func (a *Adaptor) GetModelList() []string {
	return ModelList
}

func (a *Adaptor) GetChannelName() string {
	return ChannelName
}
