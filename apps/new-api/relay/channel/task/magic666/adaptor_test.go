package magic666

import (
	"io"
	"mime"
	"mime/multipart"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/QuantumNous/new-api/constant"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	"github.com/gin-gonic/gin"
)

func TestBuildRequestBodyUsesMagic666MultipartFields(t *testing.T) {
	t.Parallel()

	c, _ := gin.CreateTestContext(httptest.NewRecorder())
	c.Request = httptest.NewRequest("POST", "/v1/videos", strings.NewReader(`{"prompt":"hello"}`))
	c.Request.Header.Set("Content-Type", "application/json")
	c.Set("task_request", relaycommon.TaskSubmitReq{
		Prompt:   "hello",
		Model:    "sora2",
		Size:     "1280x720",
		Duration: 8,
		Metadata: map[string]interface{}{
			"character_url":        "https://example.com/char.png",
			"character_timestamps": "1,2",
		},
	})

	adaptor := &TaskAdaptor{}
	body, err := adaptor.BuildRequestBody(c, &relaycommon.RelayInfo{})
	if err != nil {
		t.Fatalf("BuildRequestBody error: %v", err)
	}
	data, err := io.ReadAll(body)
	if err != nil {
		t.Fatalf("read body: %v", err)
	}
	text := string(data)
	for _, want := range []string{"sora-2-8s", "hello", "1280x720", "https://example.com/char.png", "1,2"} {
		if !strings.Contains(text, want) {
			t.Fatalf("multipart body missing %q: %s", want, text)
		}
	}
}

func TestBuildRequestBodyAddsJSONImagesAsInputReferenceFiles(t *testing.T) {
	t.Parallel()

	c, _ := gin.CreateTestContext(httptest.NewRecorder())
	c.Request = httptest.NewRequest("POST", "/v1/videos", strings.NewReader(`{"prompt":"hello"}`))
	c.Request.Header.Set("Content-Type", "application/json")
	c.Set("task_request", relaycommon.TaskSubmitReq{
		Prompt:  "hello",
		Model:   "sora2",
		Size:    "720x1280",
		Seconds: "4",
		Images:  []string{"data:image/png;base64,aGVsbG8taW1hZ2U="},
	})

	adaptor := &TaskAdaptor{}
	body, err := adaptor.BuildRequestBody(c, &relaycommon.RelayInfo{})
	if err != nil {
		t.Fatalf("BuildRequestBody error: %v", err)
	}
	data, err := io.ReadAll(body)
	if err != nil {
		t.Fatalf("read body: %v", err)
	}
	_, params, err := mime.ParseMediaType(c.Request.Header.Get("Content-Type"))
	if err != nil {
		t.Fatalf("parse content type: %v", err)
	}
	reader := multipart.NewReader(strings.NewReader(string(data)), params["boundary"])
	form, err := reader.ReadForm(1024 * 1024)
	if err != nil {
		t.Fatalf("read multipart form: %v", err)
	}
	files := form.File["input_reference"]
	if len(files) != 1 {
		t.Fatalf("input_reference files = %d", len(files))
	}
	if files[0].Header.Get("Content-Type") != "image/png" {
		t.Fatalf("input_reference content type = %q", files[0].Header.Get("Content-Type"))
	}
	file, err := files[0].Open()
	if err != nil {
		t.Fatalf("open input_reference: %v", err)
	}
	fileData, err := io.ReadAll(file)
	_ = file.Close()
	if err != nil {
		t.Fatalf("read input_reference: %v", err)
	}
	if string(fileData) != "hello-image" {
		t.Fatalf("input_reference data = %q", string(fileData))
	}
}

func TestBuildRequestBodyRejectsInvalidJSONImageReference(t *testing.T) {
	t.Parallel()

	c, _ := gin.CreateTestContext(httptest.NewRecorder())
	c.Request = httptest.NewRequest("POST", "/v1/videos", strings.NewReader(`{"prompt":"hello"}`))
	c.Request.Header.Set("Content-Type", "application/json")
	c.Set("task_request", relaycommon.TaskSubmitReq{
		Prompt:  "hello",
		Model:   "sora2",
		Size:    "720x1280",
		Seconds: "4",
		Images:  []string{"data:image/png;base64,%%%"},
	})

	adaptor := &TaskAdaptor{}
	if _, err := adaptor.BuildRequestBody(c, &relaycommon.RelayInfo{}); err == nil {
		t.Fatal("expected invalid image reference to fail")
	}
}

func TestParseTaskResultMapsCompleted(t *testing.T) {
	t.Parallel()

	adaptor := &TaskAdaptor{}
	info, err := adaptor.ParseTaskResult([]byte(`{"id":"video_1","status":"completed","progress":100}`))
	if err != nil {
		t.Fatalf("ParseTaskResult error: %v", err)
	}
	if info.Status != "SUCCESS" {
		t.Fatalf("status = %q", info.Status)
	}
}

func TestValidateRequestAndSetActionAcceptsJSON(t *testing.T) {
	t.Parallel()

	c, _ := gin.CreateTestContext(httptest.NewRecorder())
	c.Request = httptest.NewRequest("POST", "/v1/videos", strings.NewReader(`{"model":"sora2","prompt":"hello","seconds":"4","size":"1280x720"}`))
	c.Request.Header.Set("Content-Type", "application/json")
	info := &relaycommon.RelayInfo{TaskRelayInfo: &relaycommon.TaskRelayInfo{}}
	adaptor := &TaskAdaptor{}
	if taskErr := adaptor.ValidateRequestAndSetAction(c, info); taskErr != nil {
		t.Fatalf("ValidateRequestAndSetAction error: %v", taskErr)
	}
	if info.Action != constant.TaskActionGenerate {
		t.Fatalf("action = %q", info.Action)
	}
}

func TestValidateRequestAndSetActionMapsSora2BySeconds(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name          string
		seconds       string
		upstreamModel string
	}{
		{name: "4s", seconds: "4", upstreamModel: "sora-2"},
		{name: "8s", seconds: "8", upstreamModel: "sora-2-8s"},
		{name: "12s", seconds: "12", upstreamModel: "sora-2-12s"},
	}
	for _, tt := range tests {
		tt := tt
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			c, _ := gin.CreateTestContext(httptest.NewRecorder())
			c.Request = httptest.NewRequest("POST", "/v1/videos", strings.NewReader(`{"model":"sora2","prompt":"hello","seconds":"`+tt.seconds+`","size":"1280x720"}`))
			c.Request.Header.Set("Content-Type", "application/json")
			info := &relaycommon.RelayInfo{TaskRelayInfo: &relaycommon.TaskRelayInfo{}}
			adaptor := &TaskAdaptor{}
			if taskErr := adaptor.ValidateRequestAndSetAction(c, info); taskErr != nil {
				t.Fatalf("ValidateRequestAndSetAction error: %v", taskErr)
			}
			stored, exists := c.Get("task_request")
			if !exists {
				t.Fatal("task_request was not stored")
			}
			req, ok := stored.(relaycommon.TaskSubmitReq)
			if !ok {
				t.Fatalf("task_request type = %T", stored)
			}
			if req.Model != tt.upstreamModel {
				t.Fatalf("model = %q, want %q", req.Model, tt.upstreamModel)
			}
			if req.Seconds != tt.seconds {
				t.Fatalf("seconds = %q, want %q", req.Seconds, tt.seconds)
			}
		})
	}
}

func TestValidateRequestAndSetActionRejectsSora2UnsupportedSeconds(t *testing.T) {
	t.Parallel()

	c, _ := gin.CreateTestContext(httptest.NewRecorder())
	c.Request = httptest.NewRequest("POST", "/v1/videos", strings.NewReader(`{"model":"sora2","prompt":"hello","seconds":"10","size":"1280x720"}`))
	c.Request.Header.Set("Content-Type", "application/json")
	info := &relaycommon.RelayInfo{TaskRelayInfo: &relaycommon.TaskRelayInfo{}}
	adaptor := &TaskAdaptor{}
	if taskErr := adaptor.ValidateRequestAndSetAction(c, info); taskErr == nil {
		t.Fatal("expected unsupported sora2 seconds to be rejected")
	}
}

func TestValidateRequestAndSetActionDefaultsSora2To4s(t *testing.T) {
	t.Parallel()

	c, _ := gin.CreateTestContext(httptest.NewRecorder())
	c.Request = httptest.NewRequest("POST", "/v1/videos", strings.NewReader(`{"model":"sora2","prompt":"hello","size":"1280x720"}`))
	c.Request.Header.Set("Content-Type", "application/json")
	info := &relaycommon.RelayInfo{TaskRelayInfo: &relaycommon.TaskRelayInfo{}}
	adaptor := &TaskAdaptor{}
	if taskErr := adaptor.ValidateRequestAndSetAction(c, info); taskErr != nil {
		t.Fatalf("ValidateRequestAndSetAction error: %v", taskErr)
	}
	stored, exists := c.Get("task_request")
	if !exists {
		t.Fatal("task_request was not stored")
	}
	req, ok := stored.(relaycommon.TaskSubmitReq)
	if !ok {
		t.Fatalf("task_request type = %T", stored)
	}
	if req.Model != "sora-2" {
		t.Fatalf("model = %q", req.Model)
	}
	if req.Seconds != "4" {
		t.Fatalf("seconds = %q", req.Seconds)
	}
}

func TestEstimateBillingScalesSora2ByDuration(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name    string
		seconds string
		want    float64
	}{
		{name: "4s", seconds: "4", want: 1},
		{name: "8s", seconds: "8", want: 2},
		{name: "12s", seconds: "12", want: 3},
	}
	for _, tt := range tests {
		tt := tt
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			c, _ := gin.CreateTestContext(httptest.NewRecorder())
			c.Request = httptest.NewRequest("POST", "/v1/videos", strings.NewReader(`{"model":"sora2","prompt":"hello","seconds":"`+tt.seconds+`","size":"1280x720"}`))
			c.Request.Header.Set("Content-Type", "application/json")
			info := &relaycommon.RelayInfo{TaskRelayInfo: &relaycommon.TaskRelayInfo{}}
			adaptor := &TaskAdaptor{}
			if taskErr := adaptor.ValidateRequestAndSetAction(c, info); taskErr != nil {
				t.Fatalf("ValidateRequestAndSetAction error: %v", taskErr)
			}
			info.OriginModelName = "sora2"
			got := adaptor.EstimateBilling(c, info)
			if got["seconds"] != tt.want {
				t.Fatalf("seconds ratio = %v, want %v", got["seconds"], tt.want)
			}
		})
	}
}

func TestValidateRequestAndSetActionRejectsDelistedVeo(t *testing.T) {
	t.Parallel()

	c, _ := gin.CreateTestContext(httptest.NewRecorder())
	c.Request = httptest.NewRequest("POST", "/v1/videos", strings.NewReader(`{"model":"veo-3.1","prompt":"hello","seconds":"8","size":"1280x720"}`))
	c.Request.Header.Set("Content-Type", "application/json")
	info := &relaycommon.RelayInfo{TaskRelayInfo: &relaycommon.TaskRelayInfo{}}
	adaptor := &TaskAdaptor{}
	if taskErr := adaptor.ValidateRequestAndSetAction(c, info); taskErr == nil {
		t.Fatal("expected delisted veo to be rejected")
	}
}

func TestBuildRequestBodyRejectsDelistedVeo(t *testing.T) {
	t.Parallel()

	c, _ := gin.CreateTestContext(httptest.NewRecorder())
	c.Request = httptest.NewRequest("POST", "/v1/videos", strings.NewReader(`{"prompt":"hello"}`))
	c.Request.Header.Set("Content-Type", "application/json")
	c.Set("task_request", relaycommon.TaskSubmitReq{
		Prompt:  "hello",
		Model:   "veo-3.1",
		Size:    "1280x720",
		Seconds: "8",
	})

	adaptor := &TaskAdaptor{}
	if _, err := adaptor.BuildRequestBody(c, &relaycommon.RelayInfo{}); err == nil {
		t.Fatal("expected delisted veo build request to fail")
	}
}

func TestModelListDoesNotExposeVeoModels(t *testing.T) {
	t.Parallel()

	for _, modelName := range ModelList {
		if strings.HasPrefix(modelName, "veo") {
			t.Fatalf("veo model %q must not be exposed", modelName)
		}
	}
}

func TestModelListExposesOnlyUnifiedSora2(t *testing.T) {
	t.Parallel()

	if len(ModelList) != 1 || ModelList[0] != "sora2" {
		t.Fatalf("ModelList = %v", ModelList)
	}
}
