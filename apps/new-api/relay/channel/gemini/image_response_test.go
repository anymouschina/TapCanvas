package gemini

import (
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/dto"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/require"
)

func TestExtractGeminiImagineImageDataPrefersMarkdownURLOverDuplicateInlineData(t *testing.T) {
	t.Parallel()

	response := dto.GeminiChatResponse{
		Candidates: []dto.GeminiChatCandidate{
			{
				Content: dto.GeminiChatContent{
					Parts: []dto.GeminiPart{
						{
							InlineData: &dto.GeminiInlineData{MimeType: "image/png", Data: " inline-image "},
						},
						{
							Text: "![generated image](https://assets.example.com/result.jpg?signature=abc&expires=18000)",
						},
					},
				},
			},
		},
	}

	require.Equal(t, []dto.ImageData{
		{Url: "https://assets.example.com/result.jpg?signature=abc&expires=18000"},
	}, extractGeminiImagineImageData(&response))
}

func TestExtractGeminiImagineImageDataKeepsInlineDataWhenNoURLExists(t *testing.T) {
	t.Parallel()

	response := dto.GeminiChatResponse{
		Candidates: []dto.GeminiChatCandidate{{
			Content: dto.GeminiChatContent{Parts: []dto.GeminiPart{{
				InlineData: &dto.GeminiInlineData{MimeType: "image/jpeg", Data: " inline-image "},
			}}},
		}},
	}

	require.Equal(t, []dto.ImageData{{B64Json: "inline-image"}}, extractGeminiImagineImageData(&response))
}

func TestExtractGeminiImagineImageDataSupportsFileDataURL(t *testing.T) {
	t.Parallel()

	const imageURL = "https://img.example.com/generated/result.jpg"
	response := dto.GeminiChatResponse{
		Candidates: []dto.GeminiChatCandidate{{
			Content: dto.GeminiChatContent{Parts: []dto.GeminiPart{
				{
					FileData: &dto.GeminiFileData{MimeType: "image/jpeg", FileUri: imageURL},
				},
				{
					Text: "![Generated Image](" + imageURL + ")",
				},
			}},
		}},
	}

	require.Equal(t, []dto.ImageData{{Url: imageURL}}, extractGeminiImagineImageData(&response))
}

func TestExtractGeminiImagineImageDataRejectsUnsafeFileDataURL(t *testing.T) {
	t.Parallel()

	response := dto.GeminiChatResponse{
		Candidates: []dto.GeminiChatCandidate{{
			Content: dto.GeminiChatContent{Parts: []dto.GeminiPart{
				{FileData: &dto.GeminiFileData{MimeType: "image/jpeg", FileUri: "file:///tmp/result.jpg"}},
				{FileData: &dto.GeminiFileData{MimeType: "video/mp4", FileUri: "https://assets.example.com/result.mp4"}},
			}},
		}},
	}

	require.Empty(t, extractGeminiImagineImageData(&response))
}

func TestExtractMarkdownImageURLsRejectsNonHTTPDestinations(t *testing.T) {
	t.Parallel()

	text := strings.Join([]string{
		"plain URL https://assets.example.com/plain.png",
		"![data](data:image/png;base64,AAAA)",
		"![relative](/generated/image.png)",
		"![credentials](https://user:password@assets.example.com/image.png)",
		"![valid](<HTTPS://assets.example.com/image.png?token=one&expires=two>)",
	}, " ")

	require.Equal(t,
		[]string{"HTTPS://assets.example.com/image.png?token=one&expires=two"},
		extractMarkdownImageURLs(text),
	)
}

func TestGeminiImagineImageHandlerReturnsMarkdownImageURL(t *testing.T) {
	t.Parallel()

	const upstreamBody = `{"candidates":[{"content":{"role":"model","parts":[{"text":"![原图链接5小时有效](https://assets.example.com/result.jpg?X-Amz-Algorithm=AWS4-HMAC-SHA256\u0026X-Amz-Expires=18000\u0026X-Amz-Signature=abc)"}]},"finishReason":"STOP","index":0}],"usageMetadata":{"promptTokenCount":18,"candidatesTokenCount":2101,"totalTokenCount":2119}}`
	upstreamResponse := &http.Response{
		StatusCode: http.StatusOK,
		Body:       io.NopCloser(strings.NewReader(upstreamBody)),
	}
	recorder := httptest.NewRecorder()
	context := gin.CreateTestContextOnly(recorder, gin.New())

	usage, handlerErr := GeminiImagineImageHandler(context, &relaycommon.RelayInfo{}, upstreamResponse)
	require.Nil(t, handlerErr)
	require.Equal(t, 18, usage.PromptTokens)
	require.Equal(t, 2101, usage.CompletionTokens)
	require.Equal(t, 2119, usage.TotalTokens)
	require.Equal(t, http.StatusOK, recorder.Code)

	var imageResponse dto.ImageResponse
	require.NoError(t, common.Unmarshal(recorder.Body.Bytes(), &imageResponse))
	require.Equal(t, []dto.ImageData{
		{Url: "https://assets.example.com/result.jpg?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Expires=18000&X-Amz-Signature=abc"},
	}, imageResponse.Data)
}

func TestGeminiImagineImageHandlerReturnsFileDataURL(t *testing.T) {
	t.Parallel()

	const upstreamBody = `{"candidates":[{"content":{"parts":[{"fileData":{"mimeType":"image/jpeg","fileUri":"https://img.example.com/generated/result.jpg"}},{"text":"Image generated successfully."}],"role":"model"},"finishReason":"STOP","index":0}],"modelVersion":"nano-banana-pro","responseId":"resp_test","usageMetadata":{"candidatesTokenCount":1353,"promptTokenCount":2,"totalTokenCount":1355}}`
	upstreamResponse := &http.Response{
		StatusCode: http.StatusOK,
		Body:       io.NopCloser(strings.NewReader(upstreamBody)),
	}
	recorder := httptest.NewRecorder()
	context := gin.CreateTestContextOnly(recorder, gin.New())

	usage, handlerErr := GeminiImagineImageHandler(context, &relaycommon.RelayInfo{}, upstreamResponse)
	require.Nil(t, handlerErr)
	require.Equal(t, 2, usage.PromptTokens)
	require.Equal(t, 1353, usage.CompletionTokens)
	require.Equal(t, 1355, usage.TotalTokens)
	require.Equal(t, http.StatusOK, recorder.Code)

	var imageResponse dto.ImageResponse
	require.NoError(t, common.Unmarshal(recorder.Body.Bytes(), &imageResponse))
	require.Equal(t, []dto.ImageData{{
		Url: "https://img.example.com/generated/result.jpg",
	}}, imageResponse.Data)
}
