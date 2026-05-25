package common

import (
	"bytes"
	"mime/multipart"
	"net/http/httptest"
	"testing"

	neoSparkMartcommon "github.com/QuantumNous/new-api/common"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/require"
)

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
