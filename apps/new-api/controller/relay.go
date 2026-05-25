package controller

import (
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
	"strings"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/dto"
	"github.com/QuantumNous/new-api/logger"
	"github.com/QuantumNous/new-api/middleware"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/relay"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	relayconstant "github.com/QuantumNous/new-api/relay/constant"
	"github.com/QuantumNous/new-api/relay/helper"
	"github.com/QuantumNous/new-api/service"
	"github.com/QuantumNous/new-api/setting"
	"github.com/QuantumNous/new-api/setting/operation_setting"
	"github.com/QuantumNous/new-api/types"

	"github.com/bytedance/gopkg/util/gopool"
	"github.com/samber/lo"

	"github.com/gin-gonic/gin"
	"github.com/gorilla/websocket"
)

func relayHandler(c *gin.Context, info *relaycommon.RelayInfo) *types.NewAPIError {
	var err *types.NewAPIError
	switch info.RelayMode {
	case relayconstant.RelayModeImagesGenerations, relayconstant.RelayModeImagesEdits:
		err = relay.ImageHelper(c, info)
	case relayconstant.RelayModeAudioSpeech:
		fallthrough
	case relayconstant.RelayModeAudioTranslation:
		fallthrough
	case relayconstant.RelayModeAudioTranscription:
		err = relay.AudioHelper(c, info)
	case relayconstant.RelayModeRerank:
		err = relay.RerankHelper(c, info)
	case relayconstant.RelayModeEmbeddings:
		err = relay.EmbeddingHelper(c, info)
	case relayconstant.RelayModeResponses, relayconstant.RelayModeResponsesCompact:
		err = relay.ResponsesHelper(c, info)
	default:
		err = relay.TextHelper(c, info)
	}
	return err
}

func geminiRelayHandler(c *gin.Context, info *relaycommon.RelayInfo) *types.NewAPIError {
	var err *types.NewAPIError
	if strings.Contains(c.Request.URL.Path, "embed") {
		err = relay.GeminiEmbeddingHandler(c, info)
	} else {
		err = relay.GeminiHelper(c, info)
	}
	return err
}

func Relay(c *gin.Context, relayFormat types.RelayFormat) {

	requestId := c.GetString(common.RequestIdKey)
	//group := common.GetContextKeyString(c, constant.ContextKeyUsingGroup)
	//originalModel := common.GetContextKeyString(c, constant.ContextKeyOriginalModel)

	var (
		NewAPIError *types.NewAPIError
		ws          *websocket.Conn
	)

	if relayFormat == types.RelayFormatOpenAIRealtime {
		var err error
		ws, err = upgrader.Upgrade(c.Writer, c.Request, nil)
		if err != nil {
			helper.WssError(c, ws, types.NewError(err, types.ErrorCodeGetChannelFailed, types.ErrOptionWithSkipRetry()).ToOpenAIError())
			return
		}
		defer ws.Close()
	}

	defer func() {
		if NewAPIError != nil {
			logger.LogError(c, fmt.Sprintf("relay error: %s", NewAPIError.Error()))
			NewAPIError.SetMessage(common.MessageWithRequestId(NewAPIError.Error(), requestId))
			switch relayFormat {
			case types.RelayFormatOpenAIRealtime:
				helper.WssError(c, ws, NewAPIError.ToOpenAIError())
			case types.RelayFormatClaude:
				c.JSON(NewAPIError.StatusCode, gin.H{
					"type":  "error",
					"error": NewAPIError.ToClaudeError(),
				})
			default:
				c.JSON(NewAPIError.StatusCode, gin.H{
					"error": NewAPIError.ToOpenAIError(),
				})
			}
		}
	}()

	request, err := helper.GetAndValidateRequest(c, relayFormat)
	if err != nil {
		// Map "request body too large" to 413 so clients can handle it correctly
		if common.IsRequestBodyTooLargeError(err) || errors.Is(err, common.ErrRequestBodyTooLarge) {
			NewAPIError = types.NewErrorWithStatusCode(err, types.ErrorCodeReadRequestBodyFailed, http.StatusRequestEntityTooLarge, types.ErrOptionWithSkipRetry())
		} else {
			NewAPIError = types.NewError(err, types.ErrorCodeInvalidRequest)
		}
		return
	}

	relayInfo, err := relaycommon.GenRelayInfo(c, relayFormat, request, ws)
	if err != nil {
		NewAPIError = types.NewError(err, types.ErrorCodeGenRelayInfoFailed)
		return
	}

	needSensitiveCheck := setting.ShouldCheckPromptSensitive()
	needCountToken := constant.CountToken
	// Avoid building huge CombineText (strings.Join) when token counting and sensitive check are both disabled.
	var meta *types.TokenCountMeta
	if needSensitiveCheck || needCountToken {
		meta = request.GetTokenCountMeta()
	} else {
		meta = fastTokenCountMetaForPricing(request)
	}

	if needSensitiveCheck && meta != nil {
		contains, words := service.CheckSensitiveText(meta.CombineText)
		if contains {
			logger.LogWarn(c, fmt.Sprintf("user sensitive words detected: %s", strings.Join(words, ", ")))
			NewAPIError = types.NewError(err, types.ErrorCodeSensitiveWordsDetected)
			return
		}
	}

	tokens, err := service.EstimateRequestToken(c, meta, relayInfo)
	if err != nil {
		NewAPIError = types.NewError(err, types.ErrorCodeCountTokenFailed)
		return
	}

	relayInfo.SetEstimatePromptTokens(tokens)

	priceData, err := helper.ModelPriceHelper(c, relayInfo, tokens, meta)
	if err != nil {
		NewAPIError = types.NewError(err, types.ErrorCodeModelPriceError, types.ErrOptionWithStatusCode(http.StatusBadRequest))
		return
	}

	// common.SetContextKey(c, constant.ContextKeyTokenCountMeta, meta)

	if priceData.FreeModel {
		logger.LogInfo(c, fmt.Sprintf("模型 %s 免费，跳过预扣费", relayInfo.OriginModelName))
	} else {
		NewAPIError = service.PreConsumeBilling(c, priceData.QuotaToPreConsume, relayInfo)
		if NewAPIError != nil {
			return
		}
	}

	defer func() {
		// Only return quota if downstream failed and quota was actually pre-consumed
		if NewAPIError != nil {
			NewAPIError = service.NormalizeViolationFeeError(NewAPIError)
			if relayInfo.Billing != nil {
				relayInfo.Billing.Refund(c)
			}
			service.ChargeViolationFeeIfNeeded(c, relayInfo, NewAPIError)
			recordFinalRelayErrorLog(c, NewAPIError)
		}
	}()

	// Build model fallback chain: try each routing candidate (alias/variant) in turn.
	// This lets any model fall through to an alternative channel/model-name when the
	// primary attempt fails, without per-model hardcoding.
	modelsChain := buildModelsChain(relayInfo.OriginModelName)
	triedChannelIds := make([]int, 0)

	for _, tryModel := range modelsChain {
		if tryModel != relayInfo.OriginModelName {
			relayInfo.OriginModelName = tryModel
		}
		retryParam := &service.RetryParam{
			Ctx:        c,
			TokenGroup: relayInfo.TokenGroup,
			ModelName:  tryModel,
			Retry:      common.GetPointer(0),
		}
		relayInfo.RetryIndex = 0
		relayInfo.LastError = nil

		for ; retryParam.GetRetry() <= common.RetryTimes; retryParam.IncreaseRetry() {
			retryParam.ExcludeChannelIds = triedChannelIds
			relayInfo.RetryIndex = retryParam.GetRetry()
			channel, channelErr := getChannel(c, relayInfo, retryParam)
			if channelErr != nil {
				logger.LogError(c, channelErr.Error())
				// When channels are exhausted during retry, surface the real upstream
				// error instead of the confusing "channel not found" message.
				if relayInfo.LastError != nil {
					NewAPIError = relayInfo.LastError
				} else {
					NewAPIError = channelErr
				}
				break
			}

			addUsedChannel(c, channel.Id)
			triedChannelIds = appendUniqueInt(triedChannelIds, channel.Id)
			bodyStorage, bodyErr := common.GetBodyStorage(c)
			if bodyErr != nil {
				// Ensure consistent 413 for oversized bodies even when error occurs later (e.g., retry path)
				if common.IsRequestBodyTooLargeError(bodyErr) || errors.Is(bodyErr, common.ErrRequestBodyTooLarge) {
					NewAPIError = types.NewErrorWithStatusCode(bodyErr, types.ErrorCodeReadRequestBodyFailed, http.StatusRequestEntityTooLarge, types.ErrOptionWithSkipRetry())
				} else {
					NewAPIError = types.NewErrorWithStatusCode(bodyErr, types.ErrorCodeReadRequestBodyFailed, http.StatusBadRequest, types.ErrOptionWithSkipRetry())
				}
				break
			}
			c.Request.Body = io.NopCloser(bodyStorage)

			switch relayFormat {
			case types.RelayFormatOpenAIRealtime:
				NewAPIError = relay.WssHelper(c, relayInfo)
			case types.RelayFormatClaude:
				NewAPIError = relay.ClaudeHelper(c, relayInfo)
			case types.RelayFormatGemini:
				NewAPIError = geminiRelayHandler(c, relayInfo)
			default:
				NewAPIError = relayHandler(c, relayInfo)
			}

			if NewAPIError == nil {
				relayInfo.LastError = nil
				return
			}

			NewAPIError = service.NormalizeViolationFeeError(NewAPIError)
			relayInfo.LastError = NewAPIError

			processChannelError(c, *types.NewChannelError(channel.Id, channel.Type, channel.Name, channel.ChannelInfo.IsMultiKey, common.GetContextKeyString(c, constant.ContextKeyChannelKey), channel.GetAutoBan()), NewAPIError, false)

			if c.Writer.Written() {
				break
			}

			if !shouldRetry(c, NewAPIError, common.RetryTimes-retryParam.GetRetry()) {
				break
			}
		}

		if NewAPIError == nil {
			return
		}
		// gpt-image-2 failed — try next model in chain
	}

	useChannel := c.GetStringSlice("use_channel")
	if len(useChannel) > 1 {
		retryLogStr := fmt.Sprintf("重试：%s", strings.Trim(strings.Join(strings.Fields(fmt.Sprint(useChannel)), "->"), "[]"))
		logger.LogInfo(c, retryLogStr)
	}
}

// buildModelsChain returns the ordered list of model names to try for a request.
// Route selection must preserve the requested model key; channel model_mapping
// is responsible for translating that key to the upstream provider model.
func buildModelsChain(originModel string) []string {
	chain := []string{originModel}

	return chain
}

func appendUniqueInt(values []int, value int) []int {
	for _, existing := range values {
		if existing == value {
			return values
		}
	}
	return append(values, value)
}

var upgrader = websocket.Upgrader{
	Subprotocols: []string{"realtime"}, // WS 握手支持的协议，如果有使用 Sec-WebSocket-Protocol，则必须在此声明对应的 Protocol TODO add other protocol
	CheckOrigin: func(r *http.Request) bool {
		return true // 允许跨域
	},
}

func addUsedChannel(c *gin.Context, channelId int) {
	useChannel := c.GetStringSlice("use_channel")
	useChannel = append(useChannel, fmt.Sprintf("%d", channelId))
	c.Set("use_channel", useChannel)
}

func fastTokenCountMetaForPricing(request dto.Request) *types.TokenCountMeta {
	if request == nil {
		return &types.TokenCountMeta{}
	}
	meta := &types.TokenCountMeta{
		TokenType: types.TokenTypeTokenizer,
	}
	switch r := request.(type) {
	case *dto.GeneralOpenAIRequest:
		maxCompletionTokens := lo.FromPtrOr(r.MaxCompletionTokens, uint(0))
		maxTokens := lo.FromPtrOr(r.MaxTokens, uint(0))
		if maxCompletionTokens > maxTokens {
			meta.MaxTokens = int(maxCompletionTokens)
		} else {
			meta.MaxTokens = int(maxTokens)
		}
	case *dto.OpenAIResponsesRequest:
		meta.MaxTokens = int(lo.FromPtrOr(r.MaxOutputTokens, uint(0)))
	case *dto.ClaudeRequest:
		meta.MaxTokens = int(lo.FromPtr(r.MaxTokens))
	case *dto.ImageRequest:
		// Pricing for image requests depends on ImagePriceRatio; safe to compute even when CountToken is disabled.
		return r.GetTokenCountMeta()
	default:
		// Best-effort: leave CombineText empty to avoid large allocations.
	}
	return meta
}

func getChannel(c *gin.Context, info *relaycommon.RelayInfo, retryParam *service.RetryParam) (*model.Channel, *types.NewAPIError) {
	if info.ChannelMeta == nil {
		autoBan := c.GetBool("auto_ban")
		autoBanInt := 1
		if !autoBan {
			autoBanInt = 0
		}
		return &model.Channel{
			Id:      c.GetInt("channel_id"),
			Type:    c.GetInt("channel_type"),
			Name:    c.GetString("channel_name"),
			AutoBan: &autoBanInt,
		}, nil
	}
	channel, selectGroup, err := service.CacheGetRandomSatisfiedChannel(retryParam)

	info.PriceData.GroupRatioInfo = helper.HandleGroupRatio(c, info)

	if err != nil {
		return nil, types.NewError(fmt.Errorf("获取分组 %s 下模型 %s 的可用渠道失败（retry）: %s", selectGroup, info.OriginModelName, err.Error()), types.ErrorCodeGetChannelFailed, types.ErrOptionWithSkipRetry())
	}
	if channel == nil {
		return nil, types.NewError(fmt.Errorf("分组 %s 下模型 %s 的可用渠道不存在（retry）", selectGroup, info.OriginModelName), types.ErrorCodeGetChannelFailed, types.ErrOptionWithSkipRetry())
	}

	NewAPIError := middleware.SetupContextForSelectedChannel(c, channel, info.OriginModelName)
	if NewAPIError != nil {
		return nil, NewAPIError
	}
	return channel, nil
}

func shouldRetry(c *gin.Context, openaiErr *types.NewAPIError, retryTimes int) bool {
	if openaiErr == nil {
		return false
	}
	if service.ShouldSkipRetryAfterChannelAffinityFailure(c) {
		return false
	}
	if types.IsSkipRetryError(openaiErr) {
		return false
	}
	if retryTimes <= 0 {
		return false
	}
	if types.IsChannelError(openaiErr) {
		return true
	}
	if _, ok := c.Get("specific_channel_id"); ok {
		return false
	}
	code := openaiErr.StatusCode
	if code >= 200 && code < 300 {
		return false
	}
	if code < 100 || code > 599 {
		return true
	}
	if operation_setting.IsAlwaysSkipRetryCode(openaiErr.GetErrorCode()) {
		return false
	}
	if code == http.StatusBadRequest && service.IsRetryableTransientUpstreamError(openaiErr) {
		return true
	}
	return operation_setting.ShouldRetryByStatusCode(code)
}

func processChannelError(c *gin.Context, channelError types.ChannelError, err *types.NewAPIError, recordErrorLog bool) {
	logger.LogError(c, fmt.Sprintf("channel error (channel #%d, status code: %d): %s", channelError.ChannelId, err.StatusCode, err.Error()))
	// 不要使用context获取渠道信息，异步处理时可能会出现渠道信息不一致的情况
	// do not use context to get channel info, there may be inconsistent channel info when processing asynchronously
	if service.ShouldDisableChannel(err) && channelError.AutoBan {
		gopool.Go(func() {
			service.DisableChannel(channelError, err.ErrorWithStatusCode())
		})
	}

	if recordErrorLog {
		recordFinalRelayErrorLog(c, err)
	}

}

func recordFinalRelayErrorLog(c *gin.Context, err *types.NewAPIError) {
	if c == nil || err == nil || !constant.ErrorLogEnabled || !types.IsRecordErrorLog(err) {
		return
	}
	userId := c.GetInt("id")
	tokenName := c.GetString("token_name")
	modelName := c.GetString("original_model")
	tokenId := c.GetInt("token_id")
	userGroup := c.GetString("group")
	channelId := c.GetInt("channel_id")
	other := make(map[string]interface{})
	if c.Request != nil && c.Request.URL != nil {
		other["request_path"] = c.Request.URL.Path
	}
	other["error_type"] = err.GetErrorType()
	other["error_code"] = err.GetErrorCode()
	other["status_code"] = err.StatusCode
	other["channel_id"] = channelId
	other["channel_name"] = c.GetString("channel_name")
	other["channel_type"] = c.GetInt("channel_type")
	adminInfo := make(map[string]interface{})
	adminInfo["use_channel"] = c.GetStringSlice("use_channel")
	isMultiKey := common.GetContextKeyBool(c, constant.ContextKeyChannelIsMultiKey)
	if isMultiKey {
		adminInfo["is_multi_key"] = true
		adminInfo["multi_key_index"] = common.GetContextKeyInt(c, constant.ContextKeyChannelMultiKeyIndex)
	}
	service.AppendChannelAffinityAdminInfo(c, adminInfo)
	other["admin_info"] = adminInfo
	startTime := common.GetContextKeyTime(c, constant.ContextKeyRequestStartTime)
	if startTime.IsZero() {
		startTime = time.Now()
	}
	useTimeSeconds := int(time.Since(startTime).Seconds())
	model.RecordErrorLog(c, userId, channelId, modelName, tokenName, err.MaskSensitiveErrorWithStatusCode(), tokenId, useTimeSeconds, common.GetContextKeyBool(c, constant.ContextKeyIsStream), userGroup, other)
}

func RelayMidjourney(c *gin.Context) {
	relayInfo, err := relaycommon.GenRelayInfo(c, types.RelayFormatMjProxy, nil, nil)

	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{
			"description": fmt.Sprintf("failed to generate relay info: %s", err.Error()),
			"type":        "upstream_error",
			"code":        4,
		})
		return
	}

	var mjErr *dto.MidjourneyResponse
	switch relayInfo.RelayMode {
	case relayconstant.RelayModeMidjourneyNotify:
		mjErr = relay.RelayMidjourneyNotify(c)
	case relayconstant.RelayModeMidjourneyTaskFetch, relayconstant.RelayModeMidjourneyTaskFetchByCondition:
		mjErr = relay.RelayMidjourneyTask(c, relayInfo.RelayMode)
	case relayconstant.RelayModeMidjourneyTaskImageSeed:
		mjErr = relay.RelayMidjourneyTaskImageSeed(c)
	case relayconstant.RelayModeSwapFace:
		mjErr = relay.RelaySwapFace(c, relayInfo)
	default:
		mjErr = relay.RelayMidjourneySubmit(c, relayInfo)
	}
	//err = relayMidjourneySubmit(c, relayMode)
	log.Println(mjErr)
	if mjErr != nil {
		statusCode := http.StatusBadRequest
		if mjErr.Code == 30 {
			mjErr.Result = "当前分组负载已饱和，请稍后再试，或升级账户以提升服务质量。"
			statusCode = http.StatusTooManyRequests
		}
		c.JSON(statusCode, gin.H{
			"description": fmt.Sprintf("%s %s", mjErr.Description, mjErr.Result),
			"type":        "upstream_error",
			"code":        mjErr.Code,
		})
		channelId := c.GetInt("channel_id")
		logger.LogError(c, fmt.Sprintf("relay error (channel #%d, status code %d): %s", channelId, statusCode, fmt.Sprintf("%s %s", mjErr.Description, mjErr.Result)))
	}
}

func RelayNotImplemented(c *gin.Context) {
	err := types.OpenAIError{
		Message: "API not implemented",
		Type:    "new_api_error",
		Param:   "",
		Code:    "api_not_implemented",
	}
	c.JSON(http.StatusNotImplemented, gin.H{
		"error": err,
	})
}

func RelayNotFound(c *gin.Context) {
	err := types.OpenAIError{
		Message: fmt.Sprintf("Invalid URL (%s %s)", c.Request.Method, c.Request.URL.Path),
		Type:    "invalid_request_error",
		Param:   "",
		Code:    "",
	}
	c.JSON(http.StatusNotFound, gin.H{
		"error": err,
	})
}

func RelayTaskFetch(c *gin.Context) {
	relayInfo, err := relaycommon.GenRelayInfo(c, types.RelayFormatTask, nil, nil)
	if err != nil {
		c.JSON(http.StatusInternalServerError, &dto.TaskError{
			Code:       "gen_relay_info_failed",
			Message:    err.Error(),
			StatusCode: http.StatusInternalServerError,
		})
		return
	}
	if taskErr := relay.RelayTaskFetch(c, relayInfo.RelayMode); taskErr != nil {
		respondTaskError(c, taskErr)
	}
}

func RelayTask(c *gin.Context) {
	relayInfo, err := relaycommon.GenRelayInfo(c, types.RelayFormatTask, nil, nil)
	if err != nil {
		c.JSON(http.StatusInternalServerError, &dto.TaskError{
			Code:       "gen_relay_info_failed",
			Message:    err.Error(),
			StatusCode: http.StatusInternalServerError,
		})
		return
	}

	if taskErr := relay.ResolveOriginTask(c, relayInfo); taskErr != nil {
		respondTaskError(c, taskErr)
		return
	}

	var result *relay.TaskSubmitResult
	var taskErr *dto.TaskError
	defer func() {
		if taskErr != nil && relayInfo.Billing != nil {
			relayInfo.Billing.Refund(c)
		}
	}()

	// Outer model chain: try routing candidates (aliases/variants) when all channels
	// for the primary model are exhausted or the inner retry stops early.
	// Locked-channel requests skip the chain and use the pre-selected channel directly.
	taskModelsChain := []string{relayInfo.OriginModelName}
	if _, locked := relayInfo.LockedChannel.(*model.Channel); !locked {
		taskModelsChain = buildModelsChain(relayInfo.OriginModelName)
	}

	for _, tryTaskModel := range taskModelsChain {
		if tryTaskModel != relayInfo.OriginModelName {
			relayInfo.OriginModelName = tryTaskModel
		}
		retryParam := &service.RetryParam{
			Ctx:        c,
			TokenGroup: relayInfo.TokenGroup,
			ModelName:  tryTaskModel,
			Retry:      common.GetPointer(0),
		}
		relayInfo.RetryIndex = 0

		for ; retryParam.GetRetry() <= common.RetryTimes; retryParam.IncreaseRetry() {
			var channel *model.Channel

			if lockedCh, ok := relayInfo.LockedChannel.(*model.Channel); ok && lockedCh != nil {
				channel = lockedCh
				if retryParam.GetRetry() > 0 {
					if setupErr := middleware.SetupContextForSelectedChannel(c, channel, relayInfo.OriginModelName); setupErr != nil {
						taskErr = service.TaskErrorWrapperLocal(setupErr.Err, "setup_locked_channel_failed", http.StatusInternalServerError)
						break
					}
				}
			} else {
				var channelErr *types.NewAPIError
				channel, channelErr = getChannel(c, relayInfo, retryParam)
				if channelErr != nil {
					logger.LogError(c, channelErr.Error())
					// When channels are exhausted during retry, keep the real upstream
					// error rather than replacing it with "channel not found".
					if taskErr == nil {
						taskErr = service.TaskErrorWrapperLocal(channelErr.Err, "get_channel_failed", http.StatusInternalServerError)
					}
					break
				}
			}

			addUsedChannel(c, channel.Id)
			retryParam.ExcludeChannelIds = append(retryParam.ExcludeChannelIds, channel.Id)
			bodyStorage, bodyErr := common.GetBodyStorage(c)
			if bodyErr != nil {
				if common.IsRequestBodyTooLargeError(bodyErr) || errors.Is(bodyErr, common.ErrRequestBodyTooLarge) {
					taskErr = service.TaskErrorWrapperLocal(bodyErr, "read_request_body_failed", http.StatusRequestEntityTooLarge)
				} else {
					taskErr = service.TaskErrorWrapperLocal(bodyErr, "read_request_body_failed", http.StatusBadRequest)
				}
				break
			}
			c.Request.Body = io.NopCloser(bodyStorage)

			relayInfo.RetryIndex = retryParam.GetRetry()
			result, taskErr = relay.RelayTaskSubmit(c, relayInfo)
			if taskErr == nil {
				break
			}

			if !taskErr.LocalError {
				processChannelError(c,
					*types.NewChannelError(channel.Id, channel.Type, channel.Name, channel.ChannelInfo.IsMultiKey,
						common.GetContextKeyString(c, constant.ContextKeyChannelKey), channel.GetAutoBan()),
					types.NewOpenAIError(taskErr.Error, types.ErrorCodeBadResponseStatusCode, taskErr.StatusCode), true)
			}

			if c.Writer.Written() {
				break
			}

			if !shouldRetryTaskRelay(c, channel.Id, taskErr, common.RetryTimes-retryParam.GetRetry()) {
				break
			}
		}

		if taskErr == nil {
			break
		}
		// current model chain item exhausted — try next variant
	}

	useChannel := c.GetStringSlice("use_channel")
	if len(useChannel) > 1 {
		retryLogStr := fmt.Sprintf("重试：%s", strings.Trim(strings.Join(strings.Fields(fmt.Sprint(useChannel)), "->"), "[]"))
		logger.LogInfo(c, retryLogStr)
	}

	// ── 成功：结算 + 日志 + 插入任务 ──
	if taskErr == nil {
		if settleErr := service.SettleBilling(c, relayInfo, result.Quota); settleErr != nil {
			common.SysError("settle task billing error: " + settleErr.Error())
		}
		service.LogTaskConsumption(c, relayInfo)

		task := model.InitTask(result.Platform, relayInfo)
		task.PrivateData.UpstreamTaskID = result.UpstreamTaskID
		task.PrivateData.BillingSource = relayInfo.BillingSource
		task.PrivateData.SubscriptionId = relayInfo.SubscriptionId
		task.PrivateData.TokenId = relayInfo.TokenId
		task.PrivateData.BillingContext = &model.TaskBillingContext{
			ModelPrice:      relayInfo.PriceData.ModelPrice,
			GroupRatio:      relayInfo.PriceData.GroupRatioInfo.GroupRatio,
			ModelRatio:      relayInfo.PriceData.ModelRatio,
			OtherRatios:     relayInfo.PriceData.OtherRatios,
			OriginModelName: relayInfo.OriginModelName,
			PerCallBilling:  common.StringsContains(constant.TaskPricePatches, relayInfo.OriginModelName) || relayInfo.PriceData.UsePrice,
		}
		task.Quota = result.Quota
		task.Data = result.TaskData
		task.Action = relayInfo.Action
		// Surface request spec (size/resolution/aspect_ratio/duration/...) into
		// task_log.properties so admins and 3rd-party integrators can debug
		// against task logs without reading channel-side request bodies.
		if submitReq, err := relaycommon.GetTaskRequest(c); err == nil {
			task.Properties.Input = submitReq.Prompt
			task.Properties.Size = submitReq.Size
			task.Properties.Resolution = submitReq.Resolution
			task.Properties.AspectRatio = submitReq.AspectRatio
			task.Properties.Duration = submitReq.Duration
			task.Properties.Seconds = submitReq.Seconds
			task.Properties.Mode = submitReq.Mode
			refCount := len(submitReq.Images) + len(submitReq.ReferenceImages) + len(submitReq.Urls)
			if submitReq.Image != "" {
				refCount++
			}
			task.Properties.ReferenceCount = refCount
			task.Properties.HasInputRef = submitReq.InputReference != ""
			// Collect all reference URLs so admins can see exact inputs in task log.
			// normalizeTaskSubmitReq merges everything into Images but does NOT clear
			// the source fields, so we deduplicate here to avoid triple-counting the
			// same URL from Images + ReferenceImages + InputReference.
			refSeen := make(map[string]struct{})
			var refUrls []string
			addRefUrl := func(u string) {
				u = strings.TrimSpace(u)
				if u == "" {
					return
				}
				if _, ok := refSeen[u]; ok {
					return
				}
				refSeen[u] = struct{}{}
				refUrls = append(refUrls, u)
			}
			for _, u := range submitReq.Images {
				addRefUrl(u)
			}
			for _, u := range submitReq.ReferenceImages {
				addRefUrl(u)
			}
			for _, u := range submitReq.Urls {
				addRefUrl(u)
			}
			addRefUrl(submitReq.Image)
			addRefUrl(submitReq.InputReference)
			task.Properties.ReferenceCount = len(refUrls)
			if len(refUrls) > 0 {
				task.Properties.ReferenceUrls = refUrls
			}
			if submitReq.Metadata != nil {
				if v, ok := submitReq.Metadata["negative_prompt"].(string); ok && strings.TrimSpace(v) != "" {
					task.Properties.NegativePrompt = strings.TrimSpace(v)
				}
				// 提取 metadata.content 中的 video_url，回写到 Properties 供控制台展示
				if videoUrl := extractVideoUrlFromMetadataContent(submitReq.Metadata); videoUrl != "" {
					task.Properties.InputVideoUrl = videoUrl
					task.Properties.HasInputRef = true
					task.Properties.ReferenceCount++
				}
			}
		}
		if insertErr := task.Insert(); insertErr != nil {
			common.SysError("insert task error: " + insertErr.Error())
		}
	}

	if taskErr != nil {
		respondTaskError(c, taskErr)
	}
}

// extractVideoUrlFromMetadataContent 从 metadata.content 数组中提取第一个 video_url 值。
// 支持两种格式：{"type":"video_url","video_url":{"url":"..."}} 和 {"video_url":"..."}
func extractVideoUrlFromMetadataContent(metadata map[string]any) string {
	contentRaw, ok := metadata["content"]
	if !ok {
		return ""
	}
	contentSlice, ok := contentRaw.([]any)
	if !ok {
		return ""
	}
	for _, item := range contentSlice {
		m, ok := item.(map[string]any)
		if !ok {
			continue
		}
		// {"type":"video_url","video_url":{"url":"..."}}
		if m["type"] == "video_url" {
			if inner, ok := m["video_url"].(map[string]any); ok {
				if u, ok := inner["url"].(string); ok && u != "" {
					return u
				}
			}
		}
		// {"video_url":"..."}
		if u, ok := m["video_url"].(string); ok && u != "" {
			return u
		}
	}
	return ""
}

// respondTaskError 统一输出 Task 错误响应（含 429 限流提示改写）
func respondTaskError(c *gin.Context, taskErr *dto.TaskError) {
	if taskErr.StatusCode == http.StatusTooManyRequests {
		taskErr.Message = "当前分组上游负载已饱和，请稍后再试"
	}
	c.JSON(taskErr.StatusCode, taskErr)
}

func shouldRetryTaskRelay(c *gin.Context, channelId int, taskErr *dto.TaskError, retryTimes int) bool {
	if taskErr == nil {
		return false
	}
	if service.ShouldSkipRetryAfterChannelAffinityFailure(c) {
		return false
	}
	if retryTimes <= 0 {
		return false
	}
	if _, ok := c.Get("specific_channel_id"); ok {
		return false
	}
	if taskErr.StatusCode == http.StatusTooManyRequests {
		return true
	}
	if taskErr.StatusCode == 307 {
		return true
	}
	if taskErr.StatusCode/100 == 5 {
		// 超时不重试
		if operation_setting.IsAlwaysSkipRetryStatusCode(taskErr.StatusCode) {
			return false
		}
		return true
	}
	if taskErr.StatusCode == http.StatusBadRequest {
		return false
	}
	if taskErr.StatusCode == 408 {
		// azure处理超时不重试
		return false
	}
	if taskErr.LocalError {
		return false
	}
	if taskErr.StatusCode/100 == 2 {
		return false
	}
	return true
}
