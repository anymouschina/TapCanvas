package openai

import (
	"bufio"
	"fmt"
	"io"
	"net/http"
	"strings"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/dto"
	"github.com/QuantumNous/new-api/logger"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	"github.com/QuantumNous/new-api/relay/helper"
	"github.com/QuantumNous/new-api/service"
	"github.com/QuantumNous/new-api/types"

	"github.com/gin-gonic/gin"
)

func OaiResponsesHandler(c *gin.Context, info *relaycommon.RelayInfo, resp *http.Response) (*dto.Usage, *types.NewAPIError) {
	defer service.CloseResponseBodyGracefully(resp)

	// read response body
	var responsesResponse dto.OpenAIResponsesResponse
	responseBody, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, types.NewOpenAIError(err, types.ErrorCodeReadResponseBodyFailed, http.StatusInternalServerError)
	}
	err = common.Unmarshal(responseBody, &responsesResponse)
	if err != nil {
		return nil, types.NewOpenAIError(err, types.ErrorCodeBadResponseBody, http.StatusInternalServerError)
	}
	if oaiError := responsesResponse.GetOpenAIError(); oaiError != nil && oaiError.Type != "" {
		return nil, types.WithOpenAIError(*oaiError, resp.StatusCode)
	}

	if responsesResponse.HasImageGenerationCall() {
		c.Set("image_generation_call", true)
		c.Set("image_generation_call_quality", responsesResponse.GetQuality())
		c.Set("image_generation_call_size", responsesResponse.GetSize())
	}

	// 写入新的 response body
	service.IOCopyBytesGracefully(c, resp, responseBody)

	// compute usage
	usage := dto.Usage{}
	if responsesResponse.Usage != nil {
		usage.PromptTokens = responsesResponse.Usage.InputTokens
		usage.CompletionTokens = responsesResponse.Usage.OutputTokens
		usage.TotalTokens = responsesResponse.Usage.TotalTokens
		if responsesResponse.Usage.InputTokensDetails != nil {
			usage.PromptTokensDetails.CachedTokens = responsesResponse.Usage.InputTokensDetails.CachedTokens
		}
	}
	if info == nil || info.ResponsesUsageInfo == nil || info.ResponsesUsageInfo.BuiltInTools == nil {
		return &usage, nil
	}
	// 解析 Tools 用量
	for _, tool := range responsesResponse.Tools {
		buildToolinfo, ok := info.ResponsesUsageInfo.BuiltInTools[common.Interface2String(tool["type"])]
		if !ok || buildToolinfo == nil {
			logger.LogError(c, fmt.Sprintf("BuiltInTools not found for tool type: %v", tool["type"]))
			continue
		}
		buildToolinfo.CallCount++
	}
	return &usage, nil
}

func OaiResponsesStreamHandler(c *gin.Context, info *relaycommon.RelayInfo, resp *http.Response) (*dto.Usage, *types.NewAPIError) {
	if resp == nil || resp.Body == nil {
		logger.LogError(c, "invalid response or response body")
		return nil, types.NewError(fmt.Errorf("invalid response"), types.ErrorCodeBadResponse)
	}

	defer service.CloseResponseBodyGracefully(resp)

	var usage = &dto.Usage{}
	var responseTextBuilder strings.Builder
	var streamError *types.NewAPIError
	terminalEventReceived := false

	helper.StreamScannerHandler(c, resp, info, func(data string, sr *helper.StreamResult) {

		// 检查当前数据是否包含 completed 状态和 usage 信息
		var streamResponse dto.ResponsesStreamResponse
		if err := common.UnmarshalJsonStr(data, &streamResponse); err != nil {
			logger.LogError(c, "failed to unmarshal stream response: "+err.Error())
			sr.Error(err)
			return
		}
		sendResponsesStreamData(c, streamResponse, data)
		switch streamResponse.Type {
		case "response.completed", "response.incomplete":
			terminalEventReceived = true
			if streamResponse.Response != nil {
				if streamResponse.Response.Usage != nil {
					if streamResponse.Response.Usage.InputTokens != 0 {
						usage.PromptTokens = streamResponse.Response.Usage.InputTokens
					}
					if streamResponse.Response.Usage.OutputTokens != 0 {
						usage.CompletionTokens = streamResponse.Response.Usage.OutputTokens
					}
					if streamResponse.Response.Usage.TotalTokens != 0 {
						usage.TotalTokens = streamResponse.Response.Usage.TotalTokens
					}
					if streamResponse.Response.Usage.InputTokensDetails != nil {
						usage.PromptTokensDetails.CachedTokens = streamResponse.Response.Usage.InputTokensDetails.CachedTokens
					}
				}
				if streamResponse.Response.HasImageGenerationCall() {
					c.Set("image_generation_call", true)
					c.Set("image_generation_call_quality", streamResponse.Response.GetQuality())
					c.Set("image_generation_call_size", streamResponse.Response.GetSize())
				}
			}
		case "response.error", "response.failed", "response.cancelled", "response.canceled":
			streamError = newResponsesStreamTerminalError(streamResponse)
			sr.Stop(streamError)
			return
		case "response.output_text.delta":
			// 处理输出文本
			responseTextBuilder.WriteString(streamResponse.Delta)
		case dto.ResponsesOutputTypeItemDone:
			// 函数调用处理
			if streamResponse.Item != nil {
				switch streamResponse.Item.Type {
				case dto.BuildInCallWebSearchCall:
					if info != nil && info.ResponsesUsageInfo != nil && info.ResponsesUsageInfo.BuiltInTools != nil {
						if webSearchTool, exists := info.ResponsesUsageInfo.BuiltInTools[dto.BuildInToolWebSearchPreview]; exists && webSearchTool != nil {
							webSearchTool.CallCount++
						}
					}
				}
			}
		}
	})

	if streamError != nil {
		return nil, streamError
	}
	if !terminalEventReceived {
		return nil, types.NewOpenAIError(
			fmt.Errorf("responses stream ended without response.completed"),
			types.ErrorCodeBadResponseBody,
			http.StatusBadGateway,
			types.ErrOptionWithSkipRetry(),
		)
	}

	if usage.CompletionTokens == 0 {
		// 计算输出文本的 token 数量
		tempStr := responseTextBuilder.String()
		if len(tempStr) > 0 {
			// 非正常结束，使用输出文本的 token 数量
			completionTokens := service.CountTextToken(tempStr, info.UpstreamModelName)
			usage.CompletionTokens = completionTokens
		}
	}

	if usage.PromptTokens == 0 && usage.CompletionTokens != 0 {
		usage.PromptTokens = info.GetEstimatePromptTokens()
	}

	usage.TotalTokens = usage.PromptTokens + usage.CompletionTokens

	return usage, nil
}

func newResponsesStreamTerminalError(streamResponse dto.ResponsesStreamResponse) *types.NewAPIError {
	if streamResponse.Response != nil {
		if oaiError := streamResponse.Response.GetOpenAIError(); oaiError != nil &&
			(oaiError.Type != "" || oaiError.Message != "" || oaiError.Code != nil) {
			return types.WithOpenAIError(
				*oaiError,
				http.StatusBadGateway,
				types.ErrOptionWithSkipRetry(),
			)
		}
	}
	var eventError types.OpenAIError
	if len(streamResponse.Error) > 0 && common.Unmarshal(streamResponse.Error, &eventError) == nil &&
		(eventError.Type != "" || eventError.Message != "" || eventError.Code != nil) {
		return types.WithOpenAIError(
			eventError,
			http.StatusBadGateway,
			types.ErrOptionWithSkipRetry(),
		)
	}

	message := fmt.Sprintf("responses stream terminated with %s", streamResponse.Type)
	if streamResponse.Response != nil && streamResponse.Response.IncompleteDetails != nil &&
		strings.TrimSpace(streamResponse.Response.IncompleteDetails.Reasoning) != "" {
		message += ": " + strings.TrimSpace(streamResponse.Response.IncompleteDetails.Reasoning)
	}
	return types.NewOpenAIError(
		fmt.Errorf("%s", message),
		types.ErrorCodeBadResponse,
		http.StatusBadGateway,
		types.ErrOptionWithSkipRetry(),
	)
}

// OaiResponsesAggregateStreamHandler consumes an upstream Responses SSE stream
// and returns a single non-stream JSON body to the client.
//
// Why this exists: some upstream relays drop the final assistant message from
// the NON-stream Responses body for reasoning models (gpt-5.x) — reasoning
// tokens are billed, yet `output` comes back empty (output:[]). The streaming
// transport always carries the message (response.output_text.delta +
// response.completed). So when a client requests a non-stream response we force
// the upstream to stream, aggregate the terminal response object here, and hand
// the client a normal JSON response. This is gated/triggered in ResponsesHelper.
// responsesOutputHasText reports whether the output already contains a message
// item carrying non-empty text (so we don't duplicate the assistant message).
func responsesOutputHasText(output []dto.ResponsesOutput) bool {
	for _, item := range output {
		if item.Type != "message" {
			continue
		}
		for _, content := range item.Content {
			if strings.TrimSpace(content.Text) != "" {
				return true
			}
		}
	}
	return false
}

func OaiResponsesAggregateStreamHandler(c *gin.Context, info *relaycommon.RelayInfo, resp *http.Response) (*dto.Usage, *types.NewAPIError) {
	if resp == nil || resp.Body == nil {
		return nil, types.NewError(fmt.Errorf("invalid response"), types.ErrorCodeBadResponse)
	}
	defer service.CloseResponseBodyGracefully(resp)

	// If the upstream ignored stream:true and answered with a normal JSON body,
	// fall back to the standard non-stream passthrough handler.
	if !strings.HasPrefix(resp.Header.Get("Content-Type"), "text/event-stream") {
		return OaiResponsesHandler(c, info, resp)
	}

	scanner := bufio.NewScanner(resp.Body)
	scanner.Buffer(make([]byte, 64*1024), 8*1024*1024)
	scanner.Split(bufio.ScanLines)

	var finalResponse *dto.OpenAIResponsesResponse
	var terminalError *types.NewAPIError
	terminalEventReceived := false
	var textBuilder strings.Builder
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" || !strings.HasPrefix(line, "data:") {
			continue
		}
		data := strings.TrimSpace(strings.TrimPrefix(line, "data:"))
		if data == "" || data == "[DONE]" {
			continue
		}
		var streamResponse dto.ResponsesStreamResponse
		if err := common.UnmarshalJsonStr(data, &streamResponse); err != nil {
			continue
		}
		switch streamResponse.Type {
		case "response.output_text.delta":
			textBuilder.WriteString(streamResponse.Delta)
		case "response.completed", "response.incomplete":
			terminalEventReceived = true
			if streamResponse.Response != nil {
				finalResponse = streamResponse.Response
			}
		case "response.error", "response.failed", "response.cancelled", "response.canceled":
			terminalError = newResponsesStreamTerminalError(streamResponse)
		}
	}
	if err := scanner.Err(); err != nil {
		return nil, types.NewError(fmt.Errorf("responses aggregate scan failed: %w", err), types.ErrorCodeBadResponseBody)
	}
	if terminalError != nil {
		return nil, terminalError
	}
	if !terminalEventReceived || finalResponse == nil {
		return nil, types.NewOpenAIError(
			fmt.Errorf("responses aggregate: upstream stream ended without response.completed or response.incomplete"),
			types.ErrorCodeBadResponseBody,
			http.StatusBadGateway,
			types.ErrOptionWithSkipRetry(),
		)
	}
	// Some upstream relays stream the assistant message only as
	// response.output_text.delta and leave the terminal response.output without a
	// message item (reasoning models: output_tokens billed, output:[] empty).
	// Reconstruct the message from the accumulated deltas so the client (which
	// asked for a non-stream response) still receives the text.
	if streamedText := textBuilder.String(); streamedText != "" && !responsesOutputHasText(finalResponse.Output) {
		finalResponse.Output = append(finalResponse.Output, dto.ResponsesOutput{
			Type:   "message",
			Role:   "assistant",
			Status: "completed",
			Content: []dto.ResponsesOutputContent{{
				Type: "output_text",
				Text: streamedText,
			}},
		})
		logger.LogInfo(c, "responses aggregate: reconstructed assistant message from streamed deltas")
	}

	if oaiError := finalResponse.GetOpenAIError(); oaiError != nil && oaiError.Type != "" {
		return nil, types.WithOpenAIError(*oaiError, http.StatusOK)
	}

	responseBody, err := common.Marshal(finalResponse)
	if err != nil {
		return nil, types.NewOpenAIError(err, types.ErrorCodeBadResponseBody, http.StatusInternalServerError)
	}

	// Emit a fresh JSON response (do NOT copy the upstream event-stream headers).
	c.Writer.Header().Set("Content-Type", "application/json")
	service.IOCopyBytesGracefully(c, nil, responseBody)

	if finalResponse.HasImageGenerationCall() {
		c.Set("image_generation_call", true)
		c.Set("image_generation_call_quality", finalResponse.GetQuality())
		c.Set("image_generation_call_size", finalResponse.GetSize())
	}

	usage := dto.Usage{}
	if finalResponse.Usage != nil {
		usage.PromptTokens = finalResponse.Usage.InputTokens
		usage.CompletionTokens = finalResponse.Usage.OutputTokens
		usage.TotalTokens = finalResponse.Usage.TotalTokens
		if finalResponse.Usage.InputTokensDetails != nil {
			usage.PromptTokensDetails.CachedTokens = finalResponse.Usage.InputTokensDetails.CachedTokens
		}
	}
	return &usage, nil
}
