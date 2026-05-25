package relay

import (
	"bytes"
	"fmt"
	"io"
	"net/http"
	"strings"

	"github.com/QuantumNous/new-api/common"
	appconstant "github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/dto"
	"github.com/QuantumNous/new-api/model"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	relayconstant "github.com/QuantumNous/new-api/relay/constant"
	"github.com/QuantumNous/new-api/relay/helper"
	"github.com/QuantumNous/new-api/service"
	"github.com/QuantumNous/new-api/setting/model_setting"
	"github.com/QuantumNous/new-api/types"

	"github.com/gin-gonic/gin"
)

func ResponsesHelper(c *gin.Context, info *relaycommon.RelayInfo) (NewAPIError *types.NewAPIError) {
	info.InitChannelMeta(c)
	upsertOriginalRequestTrace(c, info)
	if info.RelayMode == relayconstant.RelayModeResponsesCompact {
		switch info.ApiType {
		case appconstant.APITypeOpenAI, appconstant.APITypeCodex:
		default:
			return types.NewErrorWithStatusCode(
				fmt.Errorf("unsupported endpoint %q for api type %d", "/v1/responses/compact", info.ApiType),
				types.ErrorCodeInvalidRequest,
				http.StatusBadRequest,
				types.ErrOptionWithSkipRetry(),
			)
		}
	}

	var responsesReq *dto.OpenAIResponsesRequest
	switch req := info.Request.(type) {
	case *dto.OpenAIResponsesRequest:
		responsesReq = req
	case *dto.OpenAIResponsesCompactionRequest:
		responsesReq = &dto.OpenAIResponsesRequest{
			Model:              req.Model,
			Input:              req.Input,
			Instructions:       req.Instructions,
			PreviousResponseID: req.PreviousResponseID,
		}
	default:
		return types.NewErrorWithStatusCode(
			fmt.Errorf("invalid request type, expected dto.OpenAIResponsesRequest or dto.OpenAIResponsesCompactionRequest, got %T", info.Request),
			types.ErrorCodeInvalidRequest,
			http.StatusBadRequest,
			types.ErrOptionWithSkipRetry(),
		)
	}

	request, err := common.DeepCopy(responsesReq)
	if err != nil {
		return types.NewError(fmt.Errorf("failed to copy request to GeneralOpenAIRequest: %w", err), types.ErrorCodeInvalidRequest, types.ErrOptionWithSkipRetry())
	}

	err = helper.ModelMappedHelper(c, info, request)
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
	var requestBody io.Reader
	var upstreamRequestBody string
	if model_setting.GetGlobalSettings().PassThroughRequestEnabled || info.ChannelSetting.PassThroughBodyEnabled {
		storage, err := common.GetBodyStorage(c)
		if err != nil {
			upsertRequestTraceAttempt(c, info, model.RequestTraceAttemptPatch{
				ErrorMessage: err.Error(),
			})
			return types.NewError(err, types.ErrorCodeReadRequestBodyFailed, types.ErrOptionWithSkipRetry())
		}
		if bodyBytes, readErr := storage.Bytes(); readErr == nil {
			upstreamRequestBody = string(bodyBytes)
		}
		requestBody = common.ReaderOnly(storage)
	} else {
		convertedRequest, err := adaptor.ConvertOpenAIResponsesRequest(c, info, *request)
		if err != nil {
			upsertRequestTraceAttempt(c, info, model.RequestTraceAttemptPatch{
				ErrorMessage: err.Error(),
			})
			return types.NewError(err, types.ErrorCodeConvertRequestFailed, types.ErrOptionWithSkipRetry())
		}
		relaycommon.AppendRequestConversionFromRequest(info, convertedRequest)
		jsonData, err := common.Marshal(convertedRequest)
		if err != nil {
			upsertRequestTraceAttempt(c, info, model.RequestTraceAttemptPatch{
				ErrorMessage: err.Error(),
			})
			return types.NewError(err, types.ErrorCodeConvertRequestFailed, types.ErrOptionWithSkipRetry())
		}

		// remove disabled fields for OpenAI Responses API
		jsonData, err = relaycommon.RemoveDisabledFields(jsonData, info.ChannelOtherSettings, info.ChannelSetting.PassThroughBodyEnabled)
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
				upsertRequestTraceAttempt(c, info, model.RequestTraceAttemptPatch{
					ErrorMessage: err.Error(),
				})
				return NewAPIErrorFromParamOverride(err)
			}
		}

		if common.DebugEnabled {
			println("requestBody: ", string(jsonData))
		}
		upstreamRequestBody = string(jsonData)
		requestBody = bytes.NewBuffer(jsonData)
	}

	upstreamURL, _ := adaptor.GetRequestURL(info)
	upsertRequestTraceAttempt(c, info, model.RequestTraceAttemptPatch{
		UpstreamURL:         upstreamURL,
		UpstreamRequestBody: upstreamRequestBody,
	})

	var httpResp *http.Response
	resp, err := adaptor.DoRequest(c, info, requestBody)
	if err != nil {
		upsertRequestTraceAttempt(c, info, model.RequestTraceAttemptPatch{
			UpstreamURL:         upstreamURL,
			UpstreamRequestBody: upstreamRequestBody,
			ErrorMessage:        err.Error(),
		})
		return types.NewOpenAIError(err, types.ErrorCodeDoRequestFailed, http.StatusInternalServerError)
	}

	statusCodeMappingStr := c.GetString("status_code_mapping")

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

	usage, NewAPIError := adaptor.DoResponse(c, httpResp, info)
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

	usageDto := usage.(*dto.Usage)
	if info.RelayMode == relayconstant.RelayModeResponsesCompact {
		originModelName := info.OriginModelName
		originPriceData := info.PriceData

		_, err := helper.ModelPriceHelper(c, info, info.GetEstimatePromptTokens(), &types.TokenCountMeta{})
		if err != nil {
			info.OriginModelName = originModelName
			info.PriceData = originPriceData
			return types.NewError(err, types.ErrorCodeModelPriceError, types.ErrOptionWithSkipRetry(), types.ErrOptionWithStatusCode(http.StatusBadRequest))
		}
		service.PostTextConsumeQuota(c, info, usageDto, nil)

		info.OriginModelName = originModelName
		info.PriceData = originPriceData
		return nil
	}

	if strings.HasPrefix(info.OriginModelName, "gpt-4o-audio") {
		service.PostAudioConsumeQuota(c, info, usageDto, "")
	} else {
		service.PostTextConsumeQuota(c, info, usageDto, nil)
	}
	return nil
}
