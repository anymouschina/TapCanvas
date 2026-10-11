package droid

import (
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"

	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/dto"
	"github.com/QuantumNous/new-api/relay/channel"
	"github.com/QuantumNous/new-api/relay/channel/claude"
	"github.com/QuantumNous/new-api/relay/channel/gemini"
	"github.com/QuantumNous/new-api/relay/channel/openai"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	relayconstant "github.com/QuantumNous/new-api/relay/constant"
	"github.com/QuantumNous/new-api/types"
	"github.com/gin-gonic/gin"
)

// Adaptor selects an explicit wire protocol from a binding, never a model name.
// Embedded converters preserve the existing tools, media and usage contracts.
type Adaptor struct {
	channel.Adaptor
	ProtocolID string
}

func NewAdaptor(protocolID string) *Adaptor {
	a := &Adaptor{ProtocolID: protocolID}
	switch protocolID {
	case constant.ProtocolDroidAnthropic:
		a.Adaptor = &claude.Adaptor{}
	case constant.ProtocolDroidGemini:
		a.Adaptor = &gemini.Adaptor{}
	case constant.ProtocolDroidResponses, constant.ProtocolDroidChat:
		a.Adaptor = &openai.Adaptor{}
	}
	return a
}

func (a *Adaptor) Init(info *relaycommon.RelayInfo) { a.Adaptor.Init(info) }

func (a *Adaptor) RequiresResponsesForChat(string) bool {
	return a.ProtocolID == constant.ProtocolDroidResponses
}

func (a *Adaptor) GetRequestURL(info *relaycommon.RelayInfo) (string, error) {
	if info == nil || info.ChannelMeta == nil {
		return "", errors.New("droid: missing channel metadata")
	}
	base := strings.TrimRight(strings.TrimSpace(info.ChannelBaseUrl), "/")
	parsed, err := url.Parse(base)
	if err != nil || parsed.Host == "" || (parsed.Scheme != "https" && parsed.Scheme != "http") || parsed.RawQuery != "" || parsed.Fragment != "" {
		return "", errors.New("droid: base URL must be an HTTP(S) origin without query or fragment")
	}
	if parsed.Path != "" {
		return "", errors.New("droid: base URL must be an origin, such as https://api.factory.ai")
	}
	switch info.RelayMode {
	case relayconstant.RelayModeUnknown:
		if info.RelayFormat != types.RelayFormatClaude {
			return "", errors.New("droid: unsupported request format")
		}
	case relayconstant.RelayModeChatCompletions, relayconstant.RelayModeGemini:
	case relayconstant.RelayModeResponses:
		if a.ProtocolID != constant.ProtocolDroidResponses {
			return "", errors.New("droid: Responses requires the droid-responses binding")
		}
	default:
		return "", fmt.Errorf("droid: unsupported relay mode %d", info.RelayMode)
	}
	switch a.ProtocolID {
	case constant.ProtocolDroidAnthropic:
		return base + "/api/llm/a/v1/messages", nil
	case constant.ProtocolDroidResponses:
		return base + "/api/llm/o/v1/responses", nil
	case constant.ProtocolDroidChat:
		return base + "/api/llm/o/v1/chat/completions", nil
	case constant.ProtocolDroidGemini:
		return base + "/api/llm/g/v1/generate", nil
	}
	return "", fmt.Errorf("droid: unsupported protocol %q", a.ProtocolID)
}

func (a *Adaptor) DoRequest(c *gin.Context, info *relaycommon.RelayInfo, body io.Reader) (interface{}, error) {
	response, err := channel.DoApiRequest(a, c, info, body)
	if err != nil || a.ProtocolID != constant.ProtocolDroidGemini || info.IsStream || response.StatusCode != http.StatusOK {
		return response, err
	}
	// Official CLI 0.234.0 posts a plain generate body and reads SSE. Preserve a
	// non-streaming client's contract before relay handlers inspect Content-Type.
	aggregated, aggregateErr := aggregateGeminiStream(response)
	if aggregateErr != nil {
		// A 200 stream has already been accepted. Reissuing generation after a
		// broken stream could incur another charge; retain an explicit read error.
		upstreamError := types.NewError(aggregateErr, types.ErrorCodeBadResponseBody, types.ErrOptionWithSkipRetry())
		upstreamError.UpstreamStatusCode = response.StatusCode
		return nil, upstreamError
	}
	return aggregated, nil
}

func (a *Adaptor) DoResponse(c *gin.Context, response *http.Response, info *relaycommon.RelayInfo) (interface{}, *types.NewAPIError) {
	var usage interface{}
	var responseErr *types.NewAPIError
	if a.ProtocolID != constant.ProtocolDroidGemini {
		usage, responseErr = a.Adaptor.DoResponse(c, response, info)
	} else if info.RelayMode == relayconstant.RelayModeGemini {
		if info.IsStream {
			usage, responseErr = gemini.GeminiTextGenerationStreamHandler(c, info, response)
		} else {
			usage, responseErr = gemini.GeminiTextGenerationHandler(c, info, response)
		}
	} else if info.IsStream {
		usage, responseErr = gemini.GeminiChatStreamHandler(c, info, response)
	} else {
		usage, responseErr = gemini.GeminiChatHandler(c, info, response)
	}
	a.AnnotateResponseError(response, responseErr)
	return usage, responseErr
}

// AnnotateResponseError also applies when a shared wire converter parses the response.
func (a *Adaptor) AnnotateResponseError(response *http.Response, responseErr *types.NewAPIError) {
	if responseErr != nil && response != nil {
		responseErr.UpstreamStatusCode = response.StatusCode
		if response.StatusCode == http.StatusOK {
			// The upstream has accepted generation. A response parsing error must
			// not submit another paid request, and its original error remains intact.
			types.ErrOptionWithSkipRetry()(responseErr)
		}
	}
}

// Models are configured through the channel model bindings.
func (a *Adaptor) GetModelList() []string { return []string{} }

func (a *Adaptor) GetChannelName() string { return "Droid" }

// Media, embeddings and reranking are absent from the inspected Factory wire
// contract. Reject before a converter can download input media or submit a job.
func (a *Adaptor) ConvertImageRequest(*gin.Context, *relaycommon.RelayInfo, dto.ImageRequest) (interface{}, error) {
	return nil, errors.New("droid: image generation is unsupported")
}
func (a *Adaptor) ConvertAudioRequest(*gin.Context, *relaycommon.RelayInfo, dto.AudioRequest) (io.Reader, error) {
	return nil, errors.New("droid: audio is unsupported")
}
func (a *Adaptor) ConvertEmbeddingRequest(*gin.Context, *relaycommon.RelayInfo, dto.EmbeddingRequest) (interface{}, error) {
	return nil, errors.New("droid: embeddings are unsupported")
}
func (a *Adaptor) ConvertRerankRequest(*gin.Context, int, dto.RerankRequest) (interface{}, error) {
	return nil, errors.New("droid: reranking is unsupported")
}
