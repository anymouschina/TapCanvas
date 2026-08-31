package relay

import (
	"bytes"
	"fmt"
	"net/http"
	"strings"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/dto"
	"github.com/QuantumNous/new-api/logger"
	"github.com/QuantumNous/new-api/model"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	"github.com/QuantumNous/new-api/relay/helper"
	"github.com/QuantumNous/new-api/service"
	"github.com/QuantumNous/new-api/types"

	"github.com/gin-gonic/gin"
)

func EmbeddingHelper(c *gin.Context, info *relaycommon.RelayInfo) (NewAPIError *types.NewAPIError) {
	info.InitChannelMeta(c)
	upsertOriginalRequestTrace(c, info)

	embeddingReq, ok := info.Request.(*dto.EmbeddingRequest)
	if !ok {
		upsertRequestTraceAttempt(c, info, model.RequestTraceAttemptPatch{
			ErrorMessage: fmt.Sprintf("invalid request type, expected *dto.EmbeddingRequest, got %T", info.Request),
		})
		return types.NewErrorWithStatusCode(fmt.Errorf("invalid request type, expected *dto.EmbeddingRequest, got %T", info.Request), types.ErrorCodeInvalidRequest, http.StatusBadRequest, types.ErrOptionWithSkipRetry())
	}

	request, err := common.DeepCopy(embeddingReq)
	if err != nil {
		upsertRequestTraceAttempt(c, info, model.RequestTraceAttemptPatch{ErrorMessage: err.Error()})
		return types.NewError(fmt.Errorf("failed to copy request to EmbeddingRequest: %w", err), types.ErrorCodeInvalidRequest, types.ErrOptionWithSkipRetry())
	}

	err = helper.ModelMappedHelper(c, info, request)
	if err != nil {
		upsertRequestTraceAttempt(c, info, model.RequestTraceAttemptPatch{ErrorMessage: err.Error()})
		return types.NewError(err, types.ErrorCodeChannelModelMappedError, types.ErrOptionWithSkipRetry())
	}

	adaptor := GetAdaptor(info.ApiType)
	if adaptor == nil {
		errorMessage := fmt.Sprintf("invalid api type: %d", info.ApiType)
		upsertRequestTraceAttempt(c, info, model.RequestTraceAttemptPatch{ErrorMessage: errorMessage})
		return types.NewError(fmt.Errorf("invalid api type: %d", info.ApiType), types.ErrorCodeInvalidApiType, types.ErrOptionWithSkipRetry())
	}
	adaptor.Init(info)

	convertedRequest, err := adaptor.ConvertEmbeddingRequest(c, info, *request)
	if err != nil {
		upsertRequestTraceAttempt(c, info, model.RequestTraceAttemptPatch{ErrorMessage: err.Error()})
		return types.NewError(err, types.ErrorCodeConvertRequestFailed, types.ErrOptionWithSkipRetry())
	}
	relaycommon.AppendRequestConversionFromRequest(info, convertedRequest)
	jsonData, err := common.Marshal(convertedRequest)
	if err != nil {
		upsertRequestTraceAttempt(c, info, model.RequestTraceAttemptPatch{ErrorMessage: err.Error()})
		return types.NewError(err, types.ErrorCodeConvertRequestFailed, types.ErrOptionWithSkipRetry())
	}

	if len(info.ParamOverride) > 0 {
		jsonData, err = relaycommon.ApplyParamOverrideWithRelayInfo(jsonData, info)
		if err != nil {
			upsertRequestTraceAttempt(c, info, model.RequestTraceAttemptPatch{ErrorMessage: err.Error()})
			return NewAPIErrorFromParamOverride(err)
		}
	}

	logger.LogDebug(c, fmt.Sprintf("converted embedding request body: %s", string(jsonData)))
	upstreamURL, _ := adaptor.GetRequestURL(info)
	upstreamRequestBody := string(jsonData)
	upsertRequestTraceAttempt(c, info, model.RequestTraceAttemptPatch{
		UpstreamURL:         upstreamURL,
		UpstreamRequestBody: upstreamRequestBody,
	})
	requestBody := bytes.NewBuffer(jsonData)
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
			NewAPIError = service.RelayErrorHandler(c.Request.Context(), httpResp, false)
			responseBody := ""
			if responseRecorder != nil {
				responseBody = responseRecorder.body()
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

	usage, NewAPIError := adaptor.DoResponse(c, httpResp, info)
	if NewAPIError != nil {
		responseBody := ""
		if responseRecorder != nil {
			responseBody = responseRecorder.body()
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
			UpstreamResponseBody: responseRecorder.body(),
		})
	}
	usageDto, ok := usage.(*dto.Usage)
	if !ok {
		err = fmt.Errorf("invalid embedding usage type: %T", usage)
		upsertRequestTraceAttempt(c, info, model.RequestTraceAttemptPatch{
			UpstreamURL:         upstreamURL,
			UpstreamRequestBody: upstreamRequestBody,
			ErrorMessage:        err.Error(),
		})
		return types.NewError(err, types.ErrorCodeBadResponseBody, types.ErrOptionWithSkipRetry())
	}
	service.PostTextConsumeQuota(c, info, usageDto, nil)
	return nil
}
