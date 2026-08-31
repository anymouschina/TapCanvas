package claude

import (
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/dto"
	"github.com/QuantumNous/new-api/relay/channel"
	"github.com/QuantumNous/new-api/relay/channel/claude/oauth"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	"github.com/QuantumNous/new-api/setting/model_setting"
	"github.com/QuantumNous/new-api/types"

	"github.com/gin-gonic/gin"
)

type Adaptor struct {
}

func (a *Adaptor) ConvertGeminiRequest(*gin.Context, *relaycommon.RelayInfo, *dto.GeminiChatRequest) (any, error) {
	//TODO implement me
	return nil, errors.New("not implemented")
}

func (a *Adaptor) ConvertClaudeRequest(c *gin.Context, info *relaycommon.RelayInfo, request *dto.ClaudeRequest) (any, error) {
	if isClaudeOAuthInfo(info) {
		if err := injectClaudeCodeSystemIntoRequest(request); err != nil {
			return nil, err
		}
	}
	return request, nil
}

// isClaudeOAuthInfo 判断当前请求是否走 claude 订阅 OAuth 模式(info.ApiKey 为 OAuth JSON)。
func isClaudeOAuthInfo(info *relaycommon.RelayInfo) bool {
	if info == nil {
		return false
	}
	return IsClaudeOAuthKey(info.ApiKey)
}

// injectClaudeCodeSystemIntoRequest 在 OAuth 模式下确保 request.System 首块为 Claude Code
// 身份块。复用 oauth.InjectClaudeCodeSystem 的 []byte 行为契约,避免在两路转换里重复实现。
func injectClaudeCodeSystemIntoRequest(request *dto.ClaudeRequest) error {
	if request == nil {
		return nil
	}
	systemBytes, err := common.Marshal(map[string]any{"system": request.System})
	if err != nil {
		return err
	}
	injected, err := oauth.InjectClaudeCodeSystem(systemBytes)
	if err != nil {
		return err
	}
	var wrapper struct {
		System any `json:"system"`
	}
	if err := common.Unmarshal(injected, &wrapper); err != nil {
		return err
	}
	request.System = wrapper.System
	return nil
}

// EnsureClaudeCodeSystem adds the stable Claude Code identity block to a
// native Claude request when the caller did not provide it.  The operation is
// idempotent; dynamic CLI harness text and billing attribution remain owned by
// the actual Claude Code client and are never fabricated here.
func EnsureClaudeCodeSystem(request *dto.ClaudeRequest) error {
	return injectClaudeCodeSystemIntoRequest(request)
}

func (a *Adaptor) ConvertAudioRequest(c *gin.Context, info *relaycommon.RelayInfo, request dto.AudioRequest) (io.Reader, error) {
	//TODO implement me
	return nil, errors.New("not implemented")
}

func (a *Adaptor) ConvertImageRequest(c *gin.Context, info *relaycommon.RelayInfo, request dto.ImageRequest) (any, error) {
	//TODO implement me
	return nil, errors.New("not implemented")
}

func (a *Adaptor) Init(info *relaycommon.RelayInfo) {
}

func (a *Adaptor) GetRequestURL(info *relaycommon.RelayInfo) (string, error) {
	requestURL := fmt.Sprintf("%s/v1/messages", info.ChannelBaseUrl)
	if !shouldAppendClaudeBetaQuery(info) {
		return requestURL, nil
	}

	parsedURL, err := url.Parse(requestURL)
	if err != nil {
		return "", err
	}
	query := parsedURL.Query()
	query.Set("beta", "true")
	parsedURL.RawQuery = query.Encode()
	return parsedURL.String(), nil
}

func shouldAppendClaudeBetaQuery(info *relaycommon.RelayInfo) bool {
	if info == nil {
		return false
	}
	if info.IsClaudeBetaQuery {
		return true
	}
	if info.ChannelOtherSettings.ClaudeBetaQuery {
		return true
	}
	return false
}

func CommonClaudeHeadersOperation(c *gin.Context, req *http.Header, info *relaycommon.RelayInfo) {
	// common headers operation
	anthropicBeta := c.Request.Header.Get("anthropic-beta")
	if anthropicBeta != "" {
		req.Set("anthropic-beta", anthropicBeta)
	}
	model_setting.GetClaudeSettings().WriteHeaders(info.OriginModelName, req)
}

func (a *Adaptor) SetupRequestHeader(c *gin.Context, req *http.Header, info *relaycommon.RelayInfo) error {
	channel.SetupApiRequestHeader(info, c, req)

	anthropicVersion := c.Request.Header.Get("anthropic-version")
	if configuredVersion := info.ProtocolOptions["anthropic_version"]; configuredVersion != "" {
		anthropicVersion = configuredVersion
	}
	if anthropicVersion == "" {
		anthropicVersion = "2023-06-01"
	}
	req.Set("anthropic-version", anthropicVersion)

	// OAuth(订阅)模式:info.ApiKey 是 OAuth JSON。改用 Bearer access_token,
	// 不设 x-api-key,anthropic-beta 走 oauth.GetBetaHeader(确保含 oauth beta)。
	if oauthKey, err := ParseClaudeOAuthKey(info.ApiKey); err == nil {
		req.Set("Authorization", "Bearer "+oauthKey.AccessToken)
		clientBeta := c.Request.Header.Get("anthropic-beta")
		modelID := info.UpstreamModelName
		if modelID == "" {
			modelID = info.OriginModelName
		}
		req.Set("anthropic-beta", oauth.GetBetaHeader(modelID, clientBeta))
		// 不调用 CommonClaudeHeadersOperation,避免覆盖 anthropic-beta;也不设 x-api-key。
		return nil
	}

	// 原 x-api-key 路径(零回归)。
	req.Set("x-api-key", info.ApiKey)
	CommonClaudeHeadersOperation(c, req, info)
	return nil
}

func (a *Adaptor) ConvertOpenAIRequest(c *gin.Context, info *relaycommon.RelayInfo, request *dto.GeneralOpenAIRequest) (any, error) {
	if request == nil {
		return nil, errors.New("request is nil")
	}
	claudeRequest, err := RequestOpenAI2ClaudeMessage(c, *request, info.ChannelOtherSettings.ClaudeImageURLPassThrough)
	if err != nil {
		return nil, err
	}
	if isClaudeOAuthInfo(info) {
		if err := injectClaudeCodeSystemIntoRequest(claudeRequest); err != nil {
			return nil, err
		}
	}
	return claudeRequest, nil
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
	return channel.DoApiRequest(a, c, info, requestBody)
}

func (a *Adaptor) DoResponse(c *gin.Context, resp *http.Response, info *relaycommon.RelayInfo) (usage any, err *types.NewAPIError) {
	info.FinalRequestRelayFormat = types.RelayFormatClaude
	if info.IsStream {
		return ClaudeStreamHandler(c, resp, info)
	} else {
		return ClaudeHandler(c, resp, info)
	}
}

func (a *Adaptor) GetModelList() []string {
	return ModelList
}

func (a *Adaptor) GetChannelName() string {
	return ChannelName
}
