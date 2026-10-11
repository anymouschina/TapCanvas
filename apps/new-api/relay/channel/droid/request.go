package droid

import (
	"encoding/json"
	"errors"
	"fmt"
	"strings"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/dto"
	"github.com/QuantumNous/new-api/relay/channel/claude"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	"github.com/QuantumNous/new-api/service"
	"github.com/QuantumNous/new-api/types"
	"github.com/gin-gonic/gin"
)

// Factory takes the Gemini model in the body rather than Google's URL path.
// stream is deliberately absent: Factory's generate wire always returns SSE.
type GeminiRequest struct {
	dto.GeminiChatRequest
	Model string `json:"model"`
}

func (a *Adaptor) wrapGemini(info *relaycommon.RelayInfo, request *dto.GeminiChatRequest) (*GeminiRequest, error) {
	if request == nil || info == nil || info.ChannelMeta == nil || info.UpstreamModelName == "" {
		return nil, errors.New("droid: Gemini request and mapped upstream model are required")
	}
	clone := *request
	if request.SystemInstructions == nil {
		clone.SystemInstructions = &dto.GeminiChatContent{Parts: []dto.GeminiPart{{Text: DroidLine}}}
	} else if parts := request.SystemInstructions.Parts; len(parts) == 0 || !strings.HasPrefix(parts[0].Text, DroidLine) {
		instructions := *request.SystemInstructions
		instructions.Parts = append([]dto.GeminiPart{{Text: DroidLine}}, parts...)
		clone.SystemInstructions = &instructions
	}
	info.AppendRequestConversion(types.RelayFormatGemini)
	return &GeminiRequest{GeminiChatRequest: clone, Model: info.UpstreamModelName}, nil
}

func (a *Adaptor) ConvertOpenAIRequest(c *gin.Context, info *relaycommon.RelayInfo, request *dto.GeneralOpenAIRequest) (interface{}, error) {
	if request == nil {
		return nil, errors.New("droid: request is nil")
	}
	switch a.ProtocolID {
	case constant.ProtocolDroidResponses:
		converted, err := service.ChatCompletionsRequestToResponsesRequest(request)
		if err != nil {
			return nil, err
		}
		return a.ConvertOpenAIResponsesRequest(c, info, *converted)
	case constant.ProtocolDroidAnthropic:
		// Keep HTTP(S) media URLs for Factory's fetcher instead of inflating bodies.
		native, err := claude.RequestOpenAI2ClaudeMessage(c, *request, true)
		if err != nil {
			return nil, err
		}
		return prependClaudeIdentity(native)
	case constant.ProtocolDroidChat:
		clone := *request
		messages, err := prependChatIdentity(request.Messages)
		if err != nil {
			return nil, err
		}
		clone.Messages = messages
		return &clone, nil
	case constant.ProtocolDroidGemini:
		converted, err := a.Adaptor.ConvertOpenAIRequest(c, info, request)
		if err != nil {
			return nil, err
		}
		native, ok := converted.(*dto.GeminiChatRequest)
		if !ok {
			return nil, errors.New("droid: Gemini converter returned an unexpected request type")
		}
		return a.wrapGemini(info, native)
	}
	return nil, fmt.Errorf("droid: unsupported protocol %q", a.ProtocolID)
}

func (a *Adaptor) ConvertClaudeRequest(c *gin.Context, info *relaycommon.RelayInfo, request *dto.ClaudeRequest) (interface{}, error) {
	if request == nil {
		return nil, errors.New("droid: Claude request is nil")
	}
	if a.ProtocolID == constant.ProtocolDroidAnthropic {
		return prependClaudeIdentity(request)
	}
	converted, err := service.ClaudeToOpenAIRequest(*request, info)
	if err != nil {
		return nil, err
	}
	return a.ConvertOpenAIRequest(c, info, converted)
}

func (a *Adaptor) ConvertGeminiRequest(c *gin.Context, info *relaycommon.RelayInfo, request *dto.GeminiChatRequest) (interface{}, error) {
	if request == nil {
		return nil, errors.New("droid: Gemini request is nil")
	}
	if a.ProtocolID == constant.ProtocolDroidGemini {
		return a.wrapGemini(info, request)
	}
	converted, err := service.GeminiToOpenAIRequest(request, info)
	if err != nil {
		return nil, err
	}
	return a.ConvertOpenAIRequest(c, info, converted)
}

func (a *Adaptor) ConvertOpenAIResponsesRequest(c *gin.Context, info *relaycommon.RelayInfo, request dto.OpenAIResponsesRequest) (interface{}, error) {
	if info == nil || info.ChannelMeta == nil {
		return nil, errors.New("droid: missing channel metadata")
	}
	if a.ProtocolID != constant.ProtocolDroidResponses {
		return nil, errors.New("droid: Responses requires the droid-responses binding")
	}
	text := ""
	if len(request.Instructions) > 0 {
		if err := common.Unmarshal(request.Instructions, &text); err != nil {
			return nil, fmt.Errorf("droid: Responses instructions must be a string: %w", err)
		}
	}
	instructions, err := common.Marshal(withIdentity(text))
	if err != nil {
		return nil, err
	}
	request.Instructions = instructions
	if len(request.Store) == 0 {
		request.Store = json.RawMessage("false")
	}
	fast, err := fastMode(info)
	if err != nil {
		return nil, err
	}
	if fast && request.ServiceTier == "" {
		request.ServiceTier = "priority"
	}
	return request, nil
}
