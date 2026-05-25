package relay

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
	"github.com/QuantumNous/new-api/logger"
	"github.com/QuantumNous/new-api/model"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	"github.com/QuantumNous/new-api/service"
	"github.com/QuantumNous/new-api/setting/model_setting"
	"github.com/QuantumNous/new-api/types"

	"github.com/gin-gonic/gin"
)

// captureWriter wraps gin.ResponseWriter and records every byte written to
// the client, so we can extract the image URL from the final response.
type captureWriter struct {
	gin.ResponseWriter
	body []byte
}

func (w *captureWriter) Write(b []byte) (int, error) {
	w.body = append(w.body, b...)
	return w.ResponseWriter.Write(b)
}

func (w *captureWriter) WriteString(s string) (int, error) {
	return w.Write([]byte(s))
}

func ImageHelper(c *gin.Context, info *relaycommon.RelayInfo) (NewAPIError *types.NewAPIError) {
	info.InitChannelMeta(c)
	upsertOriginalRequestTrace(c, info)

	if common.DebugEnabled {
		if storage, err := common.GetBodyStorage(c); err == nil {
			if bodyBytes, readErr := storage.Bytes(); readErr == nil {
				logger.LogDebug(c, fmt.Sprintf("image third-party request body: %s", string(bodyBytes)))
			}
		}
	}

	imageReq, ok := info.Request.(*dto.ImageRequest)
	if !ok {
		return types.NewErrorWithStatusCode(fmt.Errorf("invalid request type, expected dto.ImageRequest, got %T", info.Request), types.ErrorCodeInvalidRequest, http.StatusBadRequest, types.ErrOptionWithSkipRetry())
	}

	request, err := common.DeepCopy(imageReq)
	if err != nil {
		return types.NewError(fmt.Errorf("failed to copy request to ImageRequest: %w", err), types.ErrorCodeInvalidRequest, types.ErrOptionWithSkipRetry())
	}

	err = applyChannelBoundImageModel(c, info, request)
	if err != nil {
		upsertRequestTraceAttempt(c, info, model.RequestTraceAttemptPatch{
			ErrorMessage: err.Error(),
		})
		return types.NewError(err, types.ErrorCodeChannelModelMappedError, types.ErrOptionWithSkipRetry())
	}

	adaptor := GetAdaptor(info.ApiType)
	if adaptor == nil {
		upsertRequestTraceAttempt(c, info, model.RequestTraceAttemptPatch{
			ErrorMessage: fmt.Sprintf("invalid api type: %d", info.ApiType),
		})
		return types.NewError(fmt.Errorf("invalid api type: %d", info.ApiType), types.ErrorCodeInvalidApiType, types.ErrOptionWithSkipRetry())
	}
	adaptor.Init(info)

	// Inject caller user_id into the request User field when the client hasn't
	// provided one, so upstream channels can identify the requester.
	if len(request.User) == 0 || string(request.User) == "null" {
		if uidBytes, marshalErr := common.Marshal(fmt.Sprintf("%d", info.UserId)); marshalErr == nil {
			request.User = uidBytes
		}
	}

	var requestBody io.Reader
	var upstreamRequestBody string

	if model_setting.GetGlobalSettings().PassThroughRequestEnabled || info.ChannelSetting.PassThroughBodyEnabled {
		storage, err := common.GetBodyStorage(c)
		if err != nil {
			upsertRequestTraceAttempt(c, info, model.RequestTraceAttemptPatch{
				ErrorMessage: err.Error(),
			})
			return types.NewErrorWithStatusCode(err, types.ErrorCodeReadRequestBodyFailed, http.StatusBadRequest, types.ErrOptionWithSkipRetry())
		}
		if bodyBytes, readErr := storage.Bytes(); readErr == nil {
			upstreamRequestBody = string(bodyBytes)
		}
		requestBody = common.ReaderOnly(storage)
	} else {
		convertedRequest, err := adaptor.ConvertImageRequest(c, info, *request)
		if err != nil {
			upsertRequestTraceAttempt(c, info, model.RequestTraceAttemptPatch{
				ErrorMessage: err.Error(),
			})
			return types.NewError(err, types.ErrorCodeConvertRequestFailed)
		}
		relaycommon.AppendRequestConversionFromRequest(info, convertedRequest)

		switch converted := convertedRequest.(type) {
		case *bytes.Buffer:
			upstreamRequestBody = converted.String()
			requestBody = converted
		default:
			jsonData, err := common.Marshal(convertedRequest)
			if err != nil {
				upsertRequestTraceAttempt(c, info, model.RequestTraceAttemptPatch{
					ErrorMessage: err.Error(),
				})
				return types.NewError(err, types.ErrorCodeConvertRequestFailed, types.ErrOptionWithSkipRetry())
			}

			// apply param override
			if len(info.ParamOverride) > 0 {
				jsonData, err = relaycommon.ApplyParamOverrideWithRelayInfo(jsonData, info)
				if err != nil {
					return NewAPIErrorFromParamOverride(err)
				}
			}

			if common.DebugEnabled {
				logger.LogDebug(c, fmt.Sprintf("image upstream request body: %s", string(jsonData)))
			}
			upstreamRequestBody = string(jsonData)
			requestBody = bytes.NewBuffer(jsonData)
		}
	}

	upstreamURL, _ := adaptor.GetRequestURL(info)
	upsertRequestTraceAttempt(c, info, model.RequestTraceAttemptPatch{
		UpstreamURL:         upstreamURL,
		UpstreamRequestBody: upstreamRequestBody,
	})

	statusCodeMappingStr := c.GetString("status_code_mapping")

	resp, err := adaptor.DoRequest(c, info, requestBody)
	if err != nil {
		upsertRequestTraceAttempt(c, info, model.RequestTraceAttemptPatch{
			UpstreamURL:         upstreamURL,
			UpstreamRequestBody: upstreamRequestBody,
			ErrorMessage:        err.Error(),
		})
		return types.NewOpenAIError(err, types.ErrorCodeDoRequestFailed, http.StatusInternalServerError)
	}
	var httpResp *http.Response
	var responseRecorder *responseTraceRecorder
	if resp != nil {
		httpResp = resp.(*http.Response)
		info.IsStream = info.IsStream || strings.HasPrefix(httpResp.Header.Get("Content-Type"), "text/event-stream")
		if !info.IsStream {
			httpResp, responseRecorder = attachResponseTraceRecorder(httpResp)
		}
		if httpResp.StatusCode != http.StatusOK {
			if httpResp.StatusCode == http.StatusCreated && info.ApiType == constant.APITypeReplicate {
				// replicate channel returns 201 Created when using Prefer: wait, treat it as success.
				httpResp.StatusCode = http.StatusOK
			} else {
				NewAPIError = service.RelayErrorHandler(c.Request.Context(), httpResp, false)
				responseBody := ""
				if responseRecorder != nil {
					responseBody = string(responseRecorder.data)
				}
				upsertRequestTraceAttempt(c, info, model.RequestTraceAttemptPatch{
					UpstreamURL:          upstreamURL,
					UpstreamRequestBody:  upstreamRequestBody,
					UpstreamResponseBody: responseBody,
					ErrorMessage:         NewAPIError.Error(),
				})
				// reset status code 重置状态码
				service.ResetStatusCode(NewAPIError, statusCodeMappingStr)
				return NewAPIError
			}
		}
	}

	cw := &captureWriter{ResponseWriter: c.Writer}
	c.Writer = cw
	usage, NewAPIError := adaptor.DoResponse(c, httpResp, info)
	c.Writer = cw.ResponseWriter
	if NewAPIError != nil {
		responseBody := ""
		if responseRecorder != nil {
			responseBody = string(responseRecorder.data)
		}
		upsertRequestTraceAttempt(c, info, model.RequestTraceAttemptPatch{
			UpstreamURL:          upstreamURL,
			UpstreamRequestBody:  upstreamRequestBody,
			UpstreamResponseBody: responseBody,
			ErrorMessage:         NewAPIError.Error(),
		})
		// reset status code 重置状态码
		service.ResetStatusCode(NewAPIError, statusCodeMappingStr)
		return NewAPIError
	}
	if responseRecorder != nil {
		upsertRequestTraceAttempt(c, info, model.RequestTraceAttemptPatch{
			UpstreamURL:          upstreamURL,
			UpstreamRequestBody:  upstreamRequestBody,
			UpstreamResponseBody: string(responseRecorder.data),
		})
	}

	imageN := uint(1)
	if request.N != nil {
		imageN = *request.N
	}

	// n is handled via OtherRatio so it is applied exactly once in quota
	// calculation (both price-based and ratio-based paths).
	// Adaptors may have already set a more accurate count from the
	// upstream response; only set the default when they haven't.
	if _, hasN := info.PriceData.OtherRatios["n"]; !hasN {
		info.PriceData.AddOtherRatio("n", float64(imageN))
	}

	if usage.(*dto.Usage).TotalTokens == 0 {
		usage.(*dto.Usage).TotalTokens = 1
	}
	if usage.(*dto.Usage).PromptTokens == 0 {
		usage.(*dto.Usage).PromptTokens = 1
	}

	quality := "standard"
	if request.Quality == "hd" {
		quality = "hd"
	}

	// For models with tiered fixed image pricing, update ModelPrice to the price for
	// the actual resolution tier so billing matches the pricing API.
	if info.PriceData.UsePrice {
		if tierPrice, ok := model.FixedImagePriceCNYForTier(info.OriginModelName, imageResolutionTier(*request)); ok {
			info.PriceData.ModelPrice = tierPrice
		}
	}

	var logContent []string

	if len(request.Size) > 0 {
		logContent = append(logContent, fmt.Sprintf("大小 %s", request.Size))
	}
	if len(quality) > 0 {
		logContent = append(logContent, fmt.Sprintf("品质 %s", quality))
	}
	if imageN > 0 {
		logContent = append(logContent, fmt.Sprintf("生成数量 %d", imageN))
	}

	service.PostTextConsumeQuota(c, info, usage.(*dto.Usage), logContent)

	// Insert into midjourney table so image requests appear in the 绘图日志 panel.
	action := constant.MjActionImagine
	if len(request.Image) > 0 && string(request.Image) != "null" {
		action = constant.MjActionEdits
	}
	nowMs := time.Now().UnixNano() / int64(time.Millisecond)
	submitMs := info.StartTime.UnixNano() / int64(time.Millisecond)

	imageUrl := ""
	if len(cw.body) > 0 {
		var imgResp struct {
			Data []struct {
				URL string `json:"url"`
			} `json:"data"`
		}
		if unmarshalErr := common.Unmarshal(cw.body, &imgResp); unmarshalErr == nil && len(imgResp.Data) > 0 {
			imageUrl = imgResp.Data[0].URL
		}
	}

	// Collect reference image URLs (http only; skip base64 blobs).
	var refImages []string
	appendHTTPUrls := func(raw []byte) {
		if len(raw) == 0 || string(raw) == "null" {
			return
		}
		var arr []string
		if common.Unmarshal(raw, &arr) == nil {
			for _, u := range arr {
				if strings.HasPrefix(u, "http") {
					refImages = append(refImages, u)
				}
			}
			return
		}
		var s string
		if common.Unmarshal(raw, &s) == nil && strings.HasPrefix(s, "http") {
			refImages = append(refImages, s)
		}
	}
	appendHTTPUrls(request.Image)
	for _, key := range []string{"image_urls", "images", "urls", "input_reference"} {
		if raw, ok := request.Extra[key]; ok {
			appendHTTPUrls(raw)
		}
	}

	// Serialize properties: upstream request body + reference images + caller user.
	var requestUser string
	if len(request.User) > 0 && string(request.User) != "null" {
		_ = common.Unmarshal(request.User, &requestUser)
	}
	type mjProps struct {
		UpstreamRequest string   `json:"upstreamRequest,omitempty"`
		RefImages       []string `json:"refImages,omitempty"`
		RequestUser     string   `json:"requestUser,omitempty"`
	}
	props := mjProps{UpstreamRequest: model.SanitizeLargeTextForLog(upstreamRequestBody), RefImages: refImages, RequestUser: requestUser}
	propsJSON := ""
	if b, marshalErr := common.Marshal(props); marshalErr == nil {
		propsJSON = string(b)
	}

	mjRecord := &model.Midjourney{
		UserId:     info.UserId,
		Code:       1,
		Action:     action,
		MjId:       info.RequestId,
		Prompt:     request.Prompt,
		SubmitTime: submitMs,
		StartTime:  submitMs,
		FinishTime: nowMs,
		ImageUrl:   imageUrl,
		Status:     "SUCCESS",
		Progress:   "100%",
		ChannelId:  info.ChannelId,
		Quota:      info.FinalPreConsumedQuota,
		Properties: propsJSON,
	}
	if insertErr := mjRecord.Insert(); insertErr != nil {
		logger.LogWarn(c, fmt.Sprintf("insert midjourney record failed: %v", insertErr))
	}

	return nil
}
