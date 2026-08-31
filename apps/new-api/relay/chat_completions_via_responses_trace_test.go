package relay

import (
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/dto"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/relay/channel"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	relayconstant "github.com/QuantumNous/new-api/relay/constant"
	"github.com/QuantumNous/new-api/types"
	"github.com/gin-gonic/gin"
	"github.com/glebarez/sqlite"
	"github.com/stretchr/testify/require"
	"github.com/tidwall/gjson"
	"gorm.io/gorm"
)

const responsesBridgeTraceUpstreamURL = "https://upstream.test/v1/responses"

type responsesBridgeTraceAdaptor struct {
	channel.Adaptor
	response    *http.Response
	requestErr  error
	requestBody string
}

func (a *responsesBridgeTraceAdaptor) GetRequestURL(_ *relaycommon.RelayInfo) (string, error) {
	return responsesBridgeTraceUpstreamURL, nil
}

func (a *responsesBridgeTraceAdaptor) ConvertOpenAIResponsesRequest(
	_ *gin.Context,
	_ *relaycommon.RelayInfo,
	request dto.OpenAIResponsesRequest,
) (any, error) {
	return request, nil
}

func (a *responsesBridgeTraceAdaptor) DoRequest(
	_ *gin.Context,
	_ *relaycommon.RelayInfo,
	requestBody io.Reader,
) (any, error) {
	body, err := io.ReadAll(requestBody)
	if err != nil {
		return nil, err
	}
	a.requestBody = string(body)
	if a.requestErr != nil {
		return nil, a.requestErr
	}
	return a.response, nil
}

func TestChatCompletionsViaResponsesRecordsNonStreamUpstreamTrace(t *testing.T) {
	prepareResponsesBridgeTraceDatabase(t)

	const requestID = "chat-via-responses-success"
	const upstreamResponse = `{"id":"resp_1","object":"response","created_at":1787100000,"model":"gpt-5.4","output":[{"type":"message","role":"assistant","content":[{"type":"output_text","text":"优化后的提示词"}]}],"usage":{"input_tokens":5,"output_tokens":2,"total_tokens":7}}`

	c, recorder := newResponsesBridgeTraceContext(requestID)
	info, request := newResponsesBridgeTraceRequest()
	require.NoError(t, model.UpsertRequestTraceOriginal(c, info, `{"model":"gpt-5.4","stream":false}`))

	adaptor := &responsesBridgeTraceAdaptor{
		response: &http.Response{
			StatusCode: http.StatusOK,
			Header:     http.Header{"Content-Type": []string{"application/json"}},
			Body:       io.NopCloser(strings.NewReader(upstreamResponse)),
		},
	}

	usage, relayErr := chatCompletionsViaResponses(c, info, adaptor, request)
	require.Nil(t, relayErr)
	require.NotNil(t, usage)
	require.Equal(t, 7, usage.TotalTokens)
	require.Equal(t, http.StatusOK, recorder.Code)
	require.Equal(t, "gpt-5.4", gjson.Get(adaptor.requestBody, "model").String())
	require.True(t, gjson.Get(adaptor.requestBody, "stream").Exists())
	require.False(t, gjson.Get(adaptor.requestBody, "stream").Bool())

	trace, err := model.GetRequestTraceByRequestID(requestID)
	require.NoError(t, err)
	require.Len(t, trace.Attempts, 1)
	attempt := trace.Attempts[0]
	require.Equal(t, 48, attempt.ChannelId)
	require.Equal(t, "gpt-5.4", attempt.RequestModel)
	require.Equal(t, "gpt-5.4", attempt.UpstreamModel)
	require.Equal(t, responsesBridgeTraceUpstreamURL, attempt.UpstreamURL)
	require.JSONEq(t, adaptor.requestBody, attempt.UpstreamRequestBody)
	require.JSONEq(t, upstreamResponse, attempt.UpstreamResponseBody)
	require.Empty(t, attempt.ErrorMessage)
	require.Contains(t, attempt.RequestConversion, string(types.RelayFormatOpenAIResponses))
}

func TestChatCompletionsViaResponsesRecordsRequestFailure(t *testing.T) {
	prepareResponsesBridgeTraceDatabase(t)

	const requestID = "chat-via-responses-request-failure"
	c, _ := newResponsesBridgeTraceContext(requestID)
	info, request := newResponsesBridgeTraceRequest()
	require.NoError(t, model.UpsertRequestTraceOriginal(c, info, `{"model":"gpt-5.4","stream":false}`))

	adaptor := &responsesBridgeTraceAdaptor{requestErr: errors.New("upstream dial failed")}
	usage, relayErr := chatCompletionsViaResponses(c, info, adaptor, request)
	require.Nil(t, usage)
	require.NotNil(t, relayErr)
	require.ErrorContains(t, relayErr, "upstream dial failed")

	trace, err := model.GetRequestTraceByRequestID(requestID)
	require.NoError(t, err)
	require.Len(t, trace.Attempts, 1)
	attempt := trace.Attempts[0]
	require.Equal(t, responsesBridgeTraceUpstreamURL, attempt.UpstreamURL)
	require.JSONEq(t, adaptor.requestBody, attempt.UpstreamRequestBody)
	require.Equal(t, "upstream dial failed", attempt.ErrorMessage)
	require.Contains(t, attempt.RequestConversion, string(types.RelayFormatOpenAIResponses))
}

func prepareResponsesBridgeTraceDatabase(t *testing.T) {
	t.Helper()
	previousLogDB := model.LOG_DB
	db, err := gorm.Open(sqlite.Open("file:"+t.Name()+"?mode=memory&cache=shared"), &gorm.Config{})
	require.NoError(t, err)
	require.NoError(t, db.AutoMigrate(&model.RequestTrace{}))
	model.LOG_DB = db
	t.Cleanup(func() {
		model.LOG_DB = previousLogDB
	})
}

func newResponsesBridgeTraceContext(requestID string) (*gin.Context, *httptest.ResponseRecorder) {
	recorder := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(recorder)
	c.Request = httptest.NewRequest(http.MethodPost, "/v1/chat/completions", strings.NewReader(`{"model":"gpt-5.4"}`))
	c.Set(common.RequestIdKey, requestID)
	return c, recorder
}

func newResponsesBridgeTraceRequest() (*relaycommon.RelayInfo, *dto.GeneralOpenAIRequest) {
	stream := false
	request := &dto.GeneralOpenAIRequest{
		Model: "gpt-5.4",
		Messages: []dto.Message{
			{Role: "user", Content: "请优化提示词"},
		},
		Stream: &stream,
	}
	info := &relaycommon.RelayInfo{
		UserId:          1,
		RelayMode:       relayconstant.RelayModeChatCompletions,
		OriginModelName: "gpt-5.4",
		RequestURLPath:  "/v1/chat/completions",
		RelayFormat:     types.RelayFormatOpenAI,
		Request:         request,
		ChannelMeta: &relaycommon.ChannelMeta{
			ChannelId:         48,
			UpstreamModelName: "gpt-5.4",
		},
	}
	return info, request
}
