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
	"github.com/QuantumNous/new-api/relay/keyconcurrency"
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

		// triedKeysByChannel records which (channelId -> keyIndex) accounts were already
		// attempted this request. A multi-key channel stays eligible (not excluded) until
		// all its accounts are exhausted, so a single disabled account never breaks the
		// request — we rotate to a sibling account and resend. These account switches do
		// not consume the cross-channel RetryTimes budget; only channel-level fallback does.
		triedKeysByChannel := make(map[int]map[int]bool)
		// crossChannelRetry counts only channel-level retries (the RetryTimes budget).
		crossChannelRetry := 0
		// oauthRefreshTried[channelId] 记录本请求已为该 claude OAuth 渠道刷新过几次凭证，
		// 每渠道最多刷新+重试一次，防止「刷新→仍401→再刷新」死循环。
		oauthRefreshTried := make(map[int]int)
		var retryWithinChannel *model.Channel

		for {
			retryParam.SetRetry(crossChannelRetry)
			retryParam.ExcludeChannelIds = triedChannelIds
			relayInfo.RetryIndex = crossChannelRetry
			common.SetContextKey(c, constant.ContextKeyRetryTriedKeys, triedKeysByChannel)
			var channel *model.Channel
			var channelErr *types.NewAPIError
			if retryWithinChannel != nil {
				channel = retryWithinChannel
				retryWithinChannel = nil
				channelErr = middleware.SetupContextForSelectedChannel(c, channel, relayInfo.OriginModelName)
			} else {
				channel, channelErr = getChannel(c, relayInfo, retryParam)
			}
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
			// Record the (channel, key) account about to be used so a retry skips it.
			usedKeyIndex := 0
			if channel.ChannelInfo.IsMultiKey {
				usedKeyIndex = common.GetContextKeyInt(c, constant.ContextKeyChannelMultiKeyIndex)
			}
			if triedKeysByChannel[channel.Id] == nil {
				triedKeysByChannel[channel.Id] = make(map[int]bool)
			}
			triedKeysByChannel[channel.Id][usedKeyIndex] = true
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

			// 每账号(每 OAuth key)并发闸——Claude/Gemini OAuth 渠道生效。发上游前
			// 预留一个在飞槽位,relay helper 返回(流式则流播完)后归还。账号并发已满时
			// 不触上游、不计入错误/禁号,直接换同渠道其他空槽账号;全部满则 surface 429
			// all_accounts_at_capacity,交由调用方退避重试。
			var releaseKeySlot func()
			usingKey := common.GetContextKeyString(c, constant.ContextKeyChannelKey)
			isPerAccountOAuth := (channel.Type == constant.ChannelTypeAnthropic && service.IsClaudeOAuthKey(usingKey)) ||
				(channel.Type == constant.ChannelTypeGemini && service.IsGeminiOAuthKey(usingKey))
			if isPerAccountOAuth {
				if limit := channel.GetSetting().OAuthKeyConcurrency; limit > 0 {
					release, ok := keyconcurrency.TryAcquire(channel.Id, usedKeyIndex, limit)
					if !ok {
						capErr := types.NewErrorWithStatusCode(
							errors.New("all OAuth accounts are at their configured concurrency limit"),
							types.ErrorCodeChannelAllAccountsAtCapacity,
							http.StatusTooManyRequests,
							types.ErrOptionWithNoRecordErrorLog(),
						)
						NewAPIError = capErr
						relayInfo.LastError = capErr
						// 优先换同渠道其他未试账号(getChannel 下轮读 tried keys 自动跳过本账号)。
						if channelHasUntriedKey(channel, triedKeysByChannel[channel.Id]) {
							logger.LogInfo(c, fmt.Sprintf("渠道 #%d 账号 #%d 并发已满，切换同渠道其他账号（不计入重试次数）", channel.Id, usedKeyIndex))
							continue
						}
						// 本渠道账号全满:排除本渠道,花一次跨渠道重试预算另寻渠道;耗尽则退出。
						triedChannelIds = appendUniqueInt(triedChannelIds, channel.Id)
						if !shouldRetry(c, capErr, common.RetryTimes-crossChannelRetry) {
							break
						}
						crossChannelRetry++
						continue
					}
					releaseKeySlot = release
				}
			}

			// 用闭包 + defer 保证槽位在每次迭代结束(含 panic 展开)必被归还;不能 defer 到
			// 整个函数返回,否则重试多轮会累积占槽。
			func() {
				if releaseKeySlot != nil {
					defer releaseKeySlot()
				}
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
			}()

			if NewAPIError == nil {
				relayInfo.LastError = nil
				return
			}

			NewAPIError = service.NormalizeViolationFeeError(NewAPIError)
			relayInfo.LastError = NewAPIError

			processChannelError(c, *types.NewChannelErrorWithKeyIndex(channel.Id, channel.Type, channel.Name, channel.ChannelInfo.IsMultiKey, common.GetContextKeyString(c, constant.ContextKeyChannelKey), channel.GetAutoBan(), usedKeyIndex), NewAPIError, false)

			// Claude/Gemini 订阅(OAuth)账号 429 = 触发限额窗口:该账号进入冷却(自动禁用+
			// 记录解封时刻,对应 provider recovery task 到点自动解禁),随后照常换号/换渠道。
			// 渠道 setting oauth_key_cooldown_seconds: -1 关闭;0/缺省用默认时长;>0 自定义秒数。
			if NewAPIError.StatusCode == http.StatusTooManyRequests && channel.ChannelInfo.IsMultiKey {
				usingKey := common.GetContextKeyString(c, constant.ContextKeyChannelKey)
				cooldownSeconds := channel.GetSetting().OAuthKeyCooldownSeconds
				switch {
				case channel.Type == constant.ChannelTypeAnthropic && service.IsClaudeOAuthKey(usingKey) && cooldownSeconds >= 0:
					service.CooldownClaudeChannelKey(channel.Id, usedKeyIndex, cooldownSeconds, NewAPIError.Error())
				case channel.Type == constant.ChannelTypeGemini && service.IsGeminiOAuthKey(usingKey) && cooldownSeconds >= 0:
					service.CooldownGeminiChannelKey(channel.Id, usedKeyIndex, cooldownSeconds, NewAPIError)
				}
			}
			if NewAPIError.StatusCode == http.StatusTooManyRequests &&
				channel.Type == constant.ChannelTypeCodex &&
				channel.ChannelInfo.IsMultiKey {
				service.RefreshCodexUsageAfterLimit(channel.Id)
			}

			if c.Writer.Written() {
				break
			}

			// Claude/Gemini 订阅(OAuth)渠道 401 = access token 一时过期。先刷新凭证(ResetCaches 会 InitChannelCache
			// 失效渠道缓存，让下一轮 getChannel 读到新 token)，再重试同一账号一次——不计入重试预算、不禁渠道。
			// 每渠道每请求最多刷新一次(oauthRefreshTried)防死循环；刷新失败则照常走下面的换号/换渠道。
			if oauthRefreshTried[channel.Id] < 1 &&
				NewAPIError.StatusCode == 401 &&
				channel.Type == constant.ChannelTypeAnthropic &&
				service.IsClaudeOAuthKey(common.GetContextKeyString(c, constant.ContextKeyChannelKey)) {
				oauthRefreshTried[channel.Id]++
				if _, _, rErr := service.RefreshClaudeChannelCredential(c.Request.Context(), channel.Id, service.ClaudeCredentialRefreshOptions{ResetCaches: true}); rErr == nil {
					delete(triedKeysByChannel[channel.Id], usedKeyIndex) // 允许用刷新后的 token 重选同账号
					logger.LogInfo(c, fmt.Sprintf("渠道 #%d Claude OAuth 401，已刷新凭证并重试同账号（不计入重试次数）", channel.Id))
					continue
				} else {
					logger.LogError(c, fmt.Sprintf("渠道 #%d Claude OAuth 401 刷新凭证失败: %v", channel.Id, rErr))
				}
			}

			if oauthRefreshTried[channel.Id] < 1 &&
				NewAPIError.StatusCode == 401 &&
				channel.Type == constant.ChannelTypeGemini &&
				service.IsGeminiOAuthKey(common.GetContextKeyString(c, constant.ContextKeyChannelKey)) {
				oauthRefreshTried[channel.Id]++
				if _, _, rErr := service.RefreshGeminiChannelKeyCredential(c.Request.Context(), channel.Id, usedKeyIndex, service.GeminiCredentialRefreshOptions{ResetCaches: true}); rErr == nil {
					delete(triedKeysByChannel[channel.Id], usedKeyIndex)
					logger.LogInfo(c, fmt.Sprintf("渠道 #%d Gemini OAuth 401，已刷新凭证并重试同账号（不计入重试次数）", channel.Id))
					continue
				} else {
					logger.LogError(c, fmt.Sprintf("渠道 #%d Gemini OAuth 401 刷新凭证失败: %v", channel.Id, rErr))
					if service.IsGeminiPermanentCredentialRefreshError(rErr) {
						service.DisableGeminiChannelKey(channel.Id, usedKeyIndex, "Gemini OAuth refresh token is permanently invalid: "+rErr.Error())
					}
				}
			}

			// Prefer rotating to a sibling account within the SAME multi-key channel before
			// falling back to another channel. This keeps the request alive when one Claude
			// account is disabled mid-flight, without consuming the cross-channel retry budget.
			if channelHasUntriedKey(channel, triedKeysByChannel[channel.Id]) &&
				shouldSwitchAccount(c, NewAPIError) {
				logger.LogInfo(c, fmt.Sprintf("渠道 #%d 当前账号失败，切换同渠道其他未尝试账号重发（不计入跨渠道重试次数）", channel.Id))
				retryWithinChannel = channel
				continue
			}

			// This channel's accounts are exhausted (or it is single-key): exclude it and
			// spend one unit of the cross-channel retry budget.
			triedChannelIds = appendUniqueInt(triedChannelIds, channel.Id)
			if !shouldRetry(c, NewAPIError, common.RetryTimes-crossChannelRetry) {
				break
			}
			crossChannelRetry++
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
	// A forced channel may still rotate across sibling keys before reaching
	// this decision, but it must never leave that channel afterwards.
	if _, ok := c.Get("specific_channel_id"); ok {
		return false
	}
	if retryTimes <= 0 {
		return false
	}
	if types.IsChannelError(openaiErr) {
		return true
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

// channelHasUntriedKey reports whether a multi-key channel still has at least one enabled
// account (key) that has not been tried this request. tried is the set of key indices already
// attempted for this channel. The just-failed account is in tried, so even though its status
// may not be marked disabled yet (auto-disable is async), it is correctly excluded here.
func channelHasUntriedKey(channel *model.Channel, tried map[int]bool) bool {
	if channel == nil || !channel.ChannelInfo.IsMultiKey {
		return false
	}
	keys := channel.GetKeys()
	statusList := channel.ChannelInfo.MultiKeyStatusList
	for i := range keys {
		status := common.ChannelStatusEnabled
		if statusList != nil {
			if s, ok := statusList[i]; ok {
				status = s
			}
		}
		if status == common.ChannelStatusEnabled && !tried[i] {
			return true
		}
	}
	return false
}

// shouldSwitchAccount reports whether the error means the current account/key is the problem
// (disabled, auth-rejected, rate-limited, or a transient upstream failure) such that retrying
// the same request with a sibling account is worthwhile. A forced channel still permits
// sibling-account rotation; it only forbids leaving that channel. Skip-retry errors never rotate.
func shouldSwitchAccount(c *gin.Context, err *types.NewAPIError) bool {
	if err == nil || types.IsSkipRetryError(err) {
		return false
	}
	// A forced channel forbids cross-channel fallback, but it must not forbid rotating
	// between accounts inside that same channel. triedKeysByChannel guarantees that each
	// account is attempted at most once, so exhausting every enabled sibling cannot loop.
	// ShouldDisableChannel catches bad-account errors (401/403/429/keyword) that
	// shouldRetry's status-code list may not; shouldRetry catches transient 5xx/timeouts.
	if service.ShouldDisableChannel(err) {
		return true
	}
	if _, forced := c.Get("specific_channel_id"); forced {
		return operation_setting.ShouldRetryByStatusCode(err.StatusCode)
	}
	return shouldRetry(c, err, 1)
}

func processChannelError(c *gin.Context, channelError types.ChannelError, err *types.NewAPIError, recordErrorLog bool) {
	logger.LogError(c, fmt.Sprintf("channel error (channel #%d, status code: %d): %s", channelError.ChannelId, err.StatusCode, err.Error()))
	// 不要使用context获取渠道信息，异步处理时可能会出现渠道信息不一致的情况
	// do not use context to get channel info, there may be inconsistent channel info when processing asynchronously
	// Claude 订阅(OAuth)渠道的 401 是「access token 一时过期」，不是渠道死亡——刷新即恢复。
	// 绝不能据此自动禁用：一禁，自动刷新任务就跳过它(只刷 status=1)→ token 烂掉 → 重新启用又 401
	// → 又禁，形成 401→禁用→token腐烂→401 死循环。OAuth 401 的恢复交给 relay 循环里的「刷新+重试」。
	isClaudeOAuthAuthError := err.StatusCode == 401 &&
		channelError.ChannelType == constant.ChannelTypeAnthropic &&
		service.IsClaudeOAuthKey(channelError.UsingKey)
	isGeminiOAuthAuthError := err.StatusCode == 401 &&
		channelError.ChannelType == constant.ChannelTypeGemini &&
		service.IsGeminiOAuthKey(channelError.UsingKey)
	if !isClaudeOAuthAuthError && !isGeminiOAuthAuthError && service.ShouldDisableChannel(err) && channelError.AutoBan {
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
	if retryAt, retrySource, ok := err.GetRetryAt(); ok {
		other["upstream_retry_at"] = retryAt
		other["upstream_retry_source"] = retrySource
	}
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
					*types.NewChannelErrorWithKeyIndex(channel.Id, channel.Type, channel.Name, channel.ChannelInfo.IsMultiKey,
						common.GetContextKeyString(c, constant.ContextKeyChannelKey), channel.GetAutoBan(), common.GetContextKeyInt(c, constant.ContextKeyChannelMultiKeyIndex)),
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
			UserPriceRatio:  relayInfo.PriceData.UserPriceRatio,
		}
		task.Quota = result.Quota
		task.Data = result.TaskData
		task.Action = relayInfo.Action
		// Surface request spec (size/resolution/aspect_ratio/duration/...) into
		// task_log.properties so admins and 3rd-party integrators can debug
		// against task logs without reading channel-side request bodies.
		// 关联本次请求的 request_trace，便于任务日志回看「原始请求体」(其中参考图仍是真实 https，
		// 不受送审 http→asset:// 转换污染)。
		task.Properties.RequestId = c.GetString(common.RequestIdKey)
		if submitReq, err := relaycommon.GetTaskRequestOriginal(c); err == nil {
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
			// 续写/参考媒体路径：参考图在 metadata.content 里（绕过 req.Images），一并提取。
			for _, u := range extractReferenceImageUrlsFromMetadataContent(submitReq.Metadata) {
				addRefUrl(u)
			}
			task.Properties.ReferenceCount = len(refUrls)
			if len(refUrls) > 0 {
				task.Properties.ReferenceUrls = refUrls
			}
			// 参考音频（metadata.content audio_url 条目）单列展示，不并入 ReferenceCount（那是图片口径）。
			if audioUrls := extractReferenceAudioUrlsFromMetadataContent(submitReq.Metadata); len(audioUrls) > 0 {
				task.Properties.ReferenceAudioUrls = audioUrls
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

// extractReferenceImageUrlsFromMetadataContent 从 metadata.content 数组中按序提取所有
// image_url 条目的 URL。续写/参考媒体路径下 hono 把参考图塞进 metadata.content（绕过
// req.Images），任务日志「入参」需要把这些图也提取出来，否则控制台展示为空。
// 支持 {"type":"image_url","image_url":{"url":"..."}} 与 {"image_url":"..."} 两种格式；
// video_url 条目跳过（参考视频另行展示）。
func extractReferenceImageUrlsFromMetadataContent(metadata map[string]any) []string {
	if metadata == nil {
		return nil
	}
	contentRaw, ok := metadata["content"]
	if !ok {
		return nil
	}
	contentSlice, ok := contentRaw.([]any)
	if !ok {
		return nil
	}
	var urls []string
	for _, item := range contentSlice {
		m, ok := item.(map[string]any)
		if !ok {
			continue
		}
		// {"type":"image_url","image_url":{"url":"..."}}
		if inner, ok := m["image_url"].(map[string]any); ok {
			if u, ok := inner["url"].(string); ok && u != "" {
				urls = append(urls, u)
			}
			continue
		}
		// {"image_url":"..."}
		if u, ok := m["image_url"].(string); ok && u != "" {
			urls = append(urls, u)
		}
	}
	return urls
}

// extractReferenceAudioUrlsFromMetadataContent 从 metadata.content 数组中按序提取所有
// audio_url 条目的 URL（seedance 原生对白的音色参考音频）。此前任务日志只提取图片/视频，
// 音频条目被静默省略——调用方对照日志误判「配音卡音频没发出去」。
// 支持 {"type":"audio_url","audio_url":{"url":"..."}} 与 {"audio_url":"..."} 两种格式。
func extractReferenceAudioUrlsFromMetadataContent(metadata map[string]any) []string {
	if metadata == nil {
		return nil
	}
	contentRaw, ok := metadata["content"]
	if !ok {
		return nil
	}
	contentSlice, ok := contentRaw.([]any)
	if !ok {
		return nil
	}
	var urls []string
	for _, item := range contentSlice {
		m, ok := item.(map[string]any)
		if !ok {
			continue
		}
		if inner, ok := m["audio_url"].(map[string]any); ok {
			if u, ok := inner["url"].(string); ok && u != "" {
				urls = append(urls, u)
			}
			continue
		}
		if u, ok := m["audio_url"].(string); ok && u != "" {
			urls = append(urls, u)
		}
	}
	return urls
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
