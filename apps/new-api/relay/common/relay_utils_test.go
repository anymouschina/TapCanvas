package common

import (
	"bytes"
	"mime/multipart"
	"net/http/httptest"
	"testing"

	neoSparkMartcommon "github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/require"
)

func TestGetFullRequestURLUsesProtocolForCloudflareGatewayPath(t *testing.T) {
	const baseURL = "https://gateway.ai.cloudflare.com/v1/account/gateway/provider"

	require.Equal(
		t,
		baseURL+"/chat/completions",
		GetFullRequestURL(baseURL, "/v1/chat/completions", constant.ProtocolOpenAI),
	)
	require.Equal(
		t,
		baseURL+"/deployment-a/chat/completions",
		GetFullRequestURL(
			baseURL,
			"/openai/deployments/deployment-a/chat/completions",
			constant.ProtocolAzureOpenAI,
		),
	)
	require.Equal(
		t,
		baseURL+"/v1/chat/completions",
		GetFullRequestURL(baseURL, "/v1/chat/completions", constant.ProtocolAnthropic),
	)
}

func TestTaskSubmitReqUnmarshalAndNormalizeTopLevelVideoFields(t *testing.T) {
	t.Parallel()

	raw := []byte(`{
		"model":"doubao-seedance-2.0-fast",
		"prompt":"动起来",
		"duration":"4",
		"size":"16:9",
		"resolution":"480p",
		"aspect_ratio":"16:9",
		"urls":["https://example.com/ref-a.png"],
		"referenceImages":["https://example.com/ref-b.png"]
	}`)

	var req TaskSubmitReq
	require.NoError(t, neoSparkMartcommon.Unmarshal(raw, &req))

	normalizeTaskSubmitReq(&req)

	require.Equal(t, 4, req.Duration)
	require.Equal(t, []string{
		"https://example.com/ref-a.png",
		"https://example.com/ref-b.png",
	}, req.Images)
	require.Equal(t, "480p", req.Metadata["resolution"])
	require.Equal(t, "16:9", req.Metadata["aspect_ratio"])
}

func TestTaskSubmitReqUnmarshalSupportsSnakeAndCamelAliases(t *testing.T) {
	t.Parallel()

	raw := []byte(`{
		"prompt":"动起来",
		"reference_images":["https://example.com/ref-a.png"],
		"aspectRatio":"9:16"
	}`)

	var req TaskSubmitReq
	require.NoError(t, neoSparkMartcommon.Unmarshal(raw, &req))

	normalizeTaskSubmitReq(&req)

	require.Equal(t, []string{"https://example.com/ref-a.png"}, req.Images)
	require.Equal(t, "9:16", req.Metadata["aspect_ratio"])
}

func TestNormalizeTaskSubmitReqIncludesInputReference(t *testing.T) {
	t.Parallel()

	req := TaskSubmitReq{
		Prompt:         "动起来",
		InputReference: "data:image/png;base64,Zm9v",
	}

	normalizeTaskSubmitReq(&req)

	require.Equal(t, []string{"data:image/png;base64,Zm9v"}, req.Images)
}

func TestValidateMultipartTaskRequestCapturesInputReferenceFile(t *testing.T) {
	t.Parallel()

	gin.SetMode(gin.TestMode)

	var body bytes.Buffer
	writer := multipart.NewWriter(&body)
	require.NoError(t, writer.WriteField("prompt", "围绕图片展开"))
	require.NoError(t, writer.WriteField("model", "doubao-seedance-2.0-fast"))
	require.NoError(t, writer.WriteField("size", "16:9"))
	part, err := writer.CreateFormFile("input_reference", "ref.png")
	require.NoError(t, err)
	_, err = part.Write([]byte("fake png bytes"))
	require.NoError(t, err)
	require.NoError(t, writer.Close())

	req := httptest.NewRequest("POST", "/v1/videos", &body)
	req.Header.Set("Content-Type", writer.FormDataContentType())

	c, _ := gin.CreateTestContext(httptest.NewRecorder())
	c.Request = req

	parsed, err := validateMultipartTaskRequest(c, &RelayInfo{}, "generate")
	require.NoError(t, err)
	require.NotEmpty(t, parsed.InputReference)
	require.Contains(t, parsed.InputReference, "data:")
	require.Len(t, parsed.Images, 1)
	require.Equal(t, parsed.InputReference, parsed.Images[0])
}

// 任务日志「入参」必须反映客户端发起请求前的原始请求体。adaptor 在审核阶段会用
// SetTaskRequest 把 http 参考图覆盖成 asset://（seedance-2.0 ARK 预上传），该改写后的
// 版本不能污染日志展示——storeTaskRequest 首次写入时另存一份不可变原始快照。
func TestTaskRequestOriginalSnapshotSurvivesAdaptorMutation(t *testing.T) {
	t.Parallel()

	c, _ := gin.CreateTestContext(httptest.NewRecorder())

	original := TaskSubmitReq{
		Prompt: "动起来",
		Model:  "doubao-seedance-2.0",
		Images: []string{"https://cdn.example.com/ref-a.png"},
	}
	storeTaskRequest(c, &RelayInfo{TaskRelayInfo: &TaskRelayInfo{}}, "generate", original)

	// adaptor 审核后覆盖 task_request 为 asset:// 版本
	mutated := original
	mutated.Images = []string{"asset://abc123"}
	SetTaskRequest(c, mutated)

	// task_request 反映改写后的值（供 BuildRequestBody 使用）
	got, err := GetTaskRequest(c)
	require.NoError(t, err)
	require.Equal(t, []string{"asset://abc123"}, got.Images)

	// 原始快照仍是 http URL（供日志「入参」展示）
	orig, err := GetTaskRequestOriginal(c)
	require.NoError(t, err)
	require.Equal(t, []string{"https://cdn.example.com/ref-a.png"}, orig.Images)
}

// 没有原始快照时（理论上不该发生），GetTaskRequestOriginal 回退到 GetTaskRequest，
// 保证调用方拿到的不是空结构。
func TestGetTaskRequestOriginalFallsBackToCurrent(t *testing.T) {
	t.Parallel()

	c, _ := gin.CreateTestContext(httptest.NewRecorder())
	SetTaskRequest(c, TaskSubmitReq{Prompt: "fallback", Images: []string{"asset://x"}})

	orig, err := GetTaskRequestOriginal(c)
	require.NoError(t, err)
	require.Equal(t, "fallback", orig.Prompt)
}
