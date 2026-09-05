package agnes

import (
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/dto"
	"github.com/QuantumNous/new-api/model"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	"github.com/QuantumNous/new-api/service"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/require"
)

func TestNormalizeTextRequestDefaultsAndPreservesExplicitZeroSeed(t *testing.T) {
	t.Parallel()
	seed := 0
	n := 1
	normalized, err := normalizeRequest(relaycommon.TaskSubmitReq{
		Model:  ModelVideo25,
		Prompt: "a calm tracking shot",
		Seed:   &seed,
		N:      &n,
	})
	require.NoError(t, err)
	require.Equal(t, "text", normalized.mode)
	require.Equal(t, 5, normalized.request.Duration)
	require.Equal(t, "720p", normalized.resolution)
	require.Equal(t, "16:9", normalized.aspectRatio)
	require.NotNil(t, normalized.request.Seed)
	require.Zero(t, *normalized.request.Seed)
}

func TestNormalizeReferenceRequestSupportsAllAgnesMedia(t *testing.T) {
	t.Parallel()
	start := 0.0
	requireAudio := false
	normalized, err := normalizeRequest(relaycommon.TaskSubmitReq{
		Model:           ModelVideo25,
		Prompt:          "use <Picture 1>, <Audio 1>, and <Video 1>",
		Seconds:         "8",
		Resolution:      "1080P",
		AspectRatio:     "9:16",
		Images:          []string{"https://example.com/image.png"},
		ReferenceAudios: []string{"https://example.com/audio.mp3"},
		VideoReferences: []relaycommon.TaskVideoReference{{
			URL:          "https://example.com/video.mp4",
			StartSeconds: &start,
			RequireAudio: &requireAudio,
		}},
	})
	require.NoError(t, err)
	require.Equal(t, "reference", normalized.mode)
	require.Equal(t, "1080p", normalized.resolution)
	require.NotNil(t, normalized.request.VideoReferences[0].StartSeconds)
	require.Zero(t, *normalized.request.VideoReferences[0].StartSeconds)
	require.NotNil(t, normalized.request.VideoReferences[0].RequireAudio)
	require.False(t, *normalized.request.VideoReferences[0].RequireAudio)
}

func TestNormalizeVideoRequestMapsOpenAIPixelSize(t *testing.T) {
	t.Parallel()
	normalized, err := normalizeRequest(relaycommon.TaskSubmitReq{
		Model:  ModelVideo25,
		Prompt: "portrait video",
		Size:   "1080x1920",
	})
	require.NoError(t, err)
	require.Equal(t, "1080p", normalized.resolution)
	require.Equal(t, "9:16", normalized.aspectRatio)
}

func TestNormalizeFlashRejectsReferenceVideo(t *testing.T) {
	t.Parallel()
	_, err := normalizeRequest(relaycommon.TaskSubmitReq{
		Model:           ModelVideo25Flash,
		Prompt:          "reference video",
		ReferenceVideos: []string{"https://example.com/video.mp4"},
	})
	require.ErrorContains(t, err, "videos is not supported")
}

func TestNormalizeRequestRejectsNonHTTPSMediaReferences(t *testing.T) {
	t.Parallel()

	for _, test := range []struct {
		name string
		req  relaycommon.TaskSubmitReq
		want string
	}{
		{
			name: "data URI first frame",
			req: relaycommon.TaskSubmitReq{
				Model:      ModelVideo25,
				Prompt:     "keyframe",
				Mode:       "keyframe",
				StartFrame: "data:image/png;base64,AAAA",
			},
			want: "first_frame must be a public HTTPS URL",
		},
		{
			name: "HTTP image",
			req: relaycommon.TaskSubmitReq{
				Model:  ModelVideo25Flash,
				Prompt: "reference",
				Mode:   "reference",
				Images: []string{"http://example.com/image.png"},
			},
			want: "images[0] must be a public HTTPS URL",
		},
		{
			name: "file ID audio",
			req: relaycommon.TaskSubmitReq{
				Model:           ModelVideo25Flash,
				Prompt:          "reference",
				Mode:            "reference",
				ReferenceAudios: []string{"file-audio"},
			},
			want: "audios[0] must be a public HTTPS URL",
		},
	} {
		t.Run(test.name, func(t *testing.T) {
			_, err := normalizeRequest(test.req)
			require.ErrorContains(t, err, test.want)
		})
	}
}

func TestBuildRequestBodyUsesAgnesWireContract(t *testing.T) {
	t.Parallel()
	seed := 0
	n := 1
	request := relaycommon.TaskSubmitReq{
		Model:       ModelVideo25Flash,
		Prompt:      "a cinematic sunrise",
		Mode:        "text",
		Duration:    4,
		Resolution:  "720p",
		AspectRatio: "16:9",
		Seed:        &seed,
		N:           &n,
	}
	context, _ := gin.CreateTestContext(httptest.NewRecorder())
	relaycommon.SetTaskRequest(context, request)
	info := &relaycommon.RelayInfo{ChannelMeta: &relaycommon.ChannelMeta{UpstreamModelName: ModelVideo25Flash}}
	body, err := (&TaskAdaptor{}).BuildRequestBody(context, info)
	require.NoError(t, err)
	data, err := io.ReadAll(body)
	require.NoError(t, err)
	var payload map[string]interface{}
	require.NoError(t, common.Unmarshal(data, &payload))
	require.Equal(t, ModelVideo25Flash, payload["model"])
	require.Equal(t, "4", payload["seconds"])
	require.Equal(t, "720P", payload["size"])
	require.Equal(t, float64(0), payload["seed"])
	require.Equal(t, float64(1), payload["n"])
}

func TestFetchTaskUsesAgnesQueryContract(t *testing.T) {
	service.InitHttpClient()
	var receivedPath string
	var receivedQuery string
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		receivedPath = request.URL.Path
		receivedQuery = request.URL.RawQuery
		require.Equal(t, "Bearer test-key", request.Header.Get("Authorization"))
		writer.Header().Set("Content-Type", "application/json")
		_, _ = writer.Write([]byte(`{"video_id":"video_123","status":"queued"}`))
	}))
	defer server.Close()

	encodedID, err := encodePollIdentity("video_123", ModelVideo25Flash)
	require.NoError(t, err)
	response, err := (&TaskAdaptor{}).FetchTask(server.URL+"/v1", "test-key", map[string]any{"task_id": encodedID}, "")
	require.NoError(t, err)
	_ = response.Body.Close()
	require.Equal(t, "/agnesapi", receivedPath)
	query, err := url.ParseQuery(receivedQuery)
	require.NoError(t, err)
	require.Equal(t, "video_123", query.Get("video_id"))
	require.Equal(t, ModelVideo25Flash, query.Get("model_name"))
}

func TestParseTaskResultExtractsMetadataURL(t *testing.T) {
	t.Parallel()
	result, err := (&TaskAdaptor{}).ParseTaskResult([]byte(`{
		"video_id":"video_123",
		"status":"completed",
		"progress":100,
		"metadata":{"url":"https://example.com/result.mp4"}
	}`))
	require.NoError(t, err)
	require.Equal(t, string(model.TaskStatusSuccess), result.Status)
	require.Equal(t, "https://example.com/result.mp4", result.Url)
	require.Equal(t, "100%", result.Progress)
}

func TestParseTaskResultFallsBackToTopLevelURL(t *testing.T) {
	t.Parallel()
	result, err := (&TaskAdaptor{}).ParseTaskResult([]byte(`{
		"id":"task_upstream",
		"status":"completed",
		"progress":100,
		"url":"https://example.com/live-result.mp4"
	}`))
	require.NoError(t, err)
	require.Equal(t, string(model.TaskStatusSuccess), result.Status)
	require.Equal(t, "https://example.com/live-result.mp4", result.Url)
	require.Equal(t, "100%", result.Progress)
}

func TestDoResponseHidesUpstreamVideoID(t *testing.T) {
	t.Parallel()
	recorder := httptest.NewRecorder()
	context, _ := gin.CreateTestContext(recorder)
	response := &http.Response{
		StatusCode: http.StatusOK,
		Body: io.NopCloser(strings.NewReader(`{
			"id":"task_upstream",
			"task_id":"task_upstream",
			"video_id":"video_secret",
			"model":"agnes-video-2.5",
			"status":"queued",
			"progress":0,
			"seconds":"5",
			"size":"720P"
		}`)),
	}
	info := &relaycommon.RelayInfo{
		OriginModelName: ModelVideo25,
		TaskRelayInfo:   &relaycommon.TaskRelayInfo{PublicTaskID: "task_public"},
	}
	encodedID, _, taskErr := (&TaskAdaptor{}).DoResponse(context, response, info)
	require.Nil(t, taskErr)
	require.NotEmpty(t, encodedID)
	require.Contains(t, recorder.Body.String(), "task_public")
	require.NotContains(t, recorder.Body.String(), "video_secret")
	require.NotContains(t, recorder.Body.String(), "task_upstream")
}

func TestConvertToOpenAIVideoUsesPublicTaskID(t *testing.T) {
	t.Parallel()
	task := &model.Task{
		TaskID:    "task_public",
		Status:    model.TaskStatusSuccess,
		Progress:  "100%",
		CreatedAt: 10,
		UpdatedAt: 20,
		Properties: model.Properties{
			OriginModelName: ModelVideo25,
		},
		Data: []byte(`{"video_id":"video_secret","status":"completed","seconds":"5","size":"720P","metadata":{"url":"https://example.com/result.mp4"}}`),
	}
	data, err := (&TaskAdaptor{}).ConvertToOpenAIVideo(task)
	require.NoError(t, err)
	var response dto.OpenAIVideo
	require.NoError(t, common.Unmarshal(data, &response))
	require.Equal(t, "task_public", response.ID)
	require.Equal(t, "https://example.com/result.mp4", response.Metadata["url"])
	require.NotContains(t, string(data), "video_secret")
}

func TestConvertToOpenAIVideoUsesTopLevelResultURL(t *testing.T) {
	t.Parallel()
	task := &model.Task{
		TaskID:   "task_public",
		Status:   model.TaskStatusSuccess,
		Progress: "100%",
		Properties: model.Properties{
			OriginModelName: ModelVideo25Flash,
		},
		Data: []byte(`{"id":"task_upstream","status":"completed","url":"https://example.com/live-result.mp4"}`),
	}
	data, err := (&TaskAdaptor{}).ConvertToOpenAIVideo(task)
	require.NoError(t, err)
	var response dto.OpenAIVideo
	require.NoError(t, common.Unmarshal(data, &response))
	require.Equal(t, "https://example.com/live-result.mp4", response.Metadata["url"])
	require.NotContains(t, string(data), "task_upstream")
}
