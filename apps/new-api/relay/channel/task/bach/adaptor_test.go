package bach

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/QuantumNous/new-api/dto"
	"github.com/QuantumNous/new-api/model"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	"github.com/gin-gonic/gin"
	"github.com/golang-jwt/jwt/v5"
)

func TestGenerateJWTToken(t *testing.T) {
	now := time.Unix(1778313600, 0)
	tokStr, err := generateJWTToken("my_ak|my_sk", now)
	if err != nil {
		t.Fatalf("generateJWTToken failed: %v", err)
	}
	parsed, err := jwt.Parse(tokStr, func(tok *jwt.Token) (any, error) {
		if tok.Method != jwt.SigningMethodHS256 {
			t.Fatalf("unexpected signing method: %v", tok.Method)
		}
		if tok.Header["typ"] != "JWT" {
			t.Fatalf("unexpected typ header: %v", tok.Header["typ"])
		}
		return []byte("my_sk"), nil
	}, jwt.WithTimeFunc(func() time.Time { return now }))
	if err != nil || !parsed.Valid {
		t.Fatalf("JWT verification failed: err=%v valid=%v", err, parsed != nil && parsed.Valid)
	}
	claims := parsed.Claims.(jwt.MapClaims)
	if claims["iss"] != "my_ak" {
		t.Fatalf("iss=%v want my_ak", claims["iss"])
	}
	if int64(claims["nbf"].(float64)) != now.Unix()-5 {
		t.Fatalf("nbf=%v want %d", claims["nbf"], now.Unix()-5)
	}
	if int64(claims["exp"].(float64)) != now.Unix()+1800 {
		t.Fatalf("exp=%v want %d", claims["exp"], now.Unix()+1800)
	}

	if _, err := generateJWTToken("only_one_part", now); err == nil {
		t.Fatal("expected error for malformed key")
	}
}

func TestNormalizePayloadModes(t *testing.T) {
	t.Run("t2v default", func(t *testing.T) {
		body := `{"model":"bach-1.0-pro","prompt":"A cinematic street scene.","duration":8,"resolution":"1080P","aspect_ratio":"16:9","seed":1101,"metadata":{"generate_audio":false}}`
		payload, req, err := NormalizePayload([]byte(body))
		if err != nil {
			t.Fatalf("unexpected err: %v", err)
		}
		if payload.ModelName != ModelBach10Pro {
			t.Fatalf("model_name=%q want %q", payload.ModelName, ModelBach10Pro)
		}
		if payload.Input.Task != "t2v" || payload.Input.Duration != 8 || payload.Input.Resolution != "1080p" || payload.Input.AspectRatio != "16:9" {
			t.Fatalf("unexpected input: %+v", payload.Input)
		}
		if payload.Input.GenerateAudio == nil || *payload.Input.GenerateAudio != false {
			t.Fatalf("expected generate_audio=false, got %v", payload.Input.GenerateAudio)
		}
		if payload.Input.Seed == nil || *payload.Input.Seed != 1101 {
			t.Fatalf("expected seed=1101, got %v", payload.Input.Seed)
		}
		if req.Duration != 8 || req.Resolution != "1080p" {
			t.Fatalf("unexpected req billing fields: duration=%d resolution=%q", req.Duration, req.Resolution)
		}
	})

	t.Run("i2v first and last frame with ads model and 4k", func(t *testing.T) {
		body := `{"model":"Bach-1.0-Pro-Ads","prompt":"Product spin.","duration":6,"size":"3840x2160","first_frame":"https://cdn.example.com/first.png","last_frame":"https://cdn.example.com/last.png"}`
		payload, req, err := NormalizePayload([]byte(body))
		if err != nil {
			t.Fatalf("unexpected err: %v", err)
		}
		if payload.ModelName != ModelBach10ProAds {
			t.Fatalf("model_name=%q want %q", payload.ModelName, ModelBach10ProAds)
		}
		if payload.Input.Task != "i2v" || payload.Input.ImageURL != "https://cdn.example.com/first.png" || payload.Input.EndImageURL != "https://cdn.example.com/last.png" {
			t.Fatalf("unexpected i2v input: %+v", payload.Input)
		}
		if payload.Input.Resolution != "4k" || req.Resolution != "4k" {
			t.Fatalf("expected 4k resolution, got payload=%q req=%q", payload.Input.Resolution, req.Resolution)
		}
		if payload.Input.AspectRatio != "" {
			t.Fatalf("expected empty aspect_ratio for i2v, got %q", payload.Input.AspectRatio)
		}
	})

	t.Run("r2v multimodal references", func(t *testing.T) {
		body := `{"model":"Bach-1.0-Pro","prompt":"Use @Video1 and @Image1 and @Audio1","duration":5,"resolution":"1080p","metadata":{"billing_reference_video_duration_seconds":5.0,"content":[
			{"type":"video_url","video_url":{"url":"https://cdn.example.com/ref.mp4"}},
			{"type":"image_url","image_url":{"url":"https://cdn.example.com/char.png"},"role":"reference_image"},
			{"type":"audio_url","audio_url":{"url":"https://cdn.example.com/voice.mp3"},"role":"reference_audio"}
		]}}`
		payload, _, err := NormalizePayload([]byte(body))
		if err != nil {
			t.Fatalf("unexpected err: %v", err)
		}
		if payload.Input.Task != "r2v" || len(payload.Input.ReferenceInputs) != 3 {
			t.Fatalf("unexpected r2v payload: %+v", payload.Input)
		}
		if payload.Input.ReferenceInputs[0].Type != "video" || payload.Input.ReferenceInputs[1].Type != "image" || payload.Input.ReferenceInputs[2].Type != "audio" {
			t.Fatalf("unexpected reference_inputs order/types: %+v", payload.Input.ReferenceInputs)
		}
	})

	t.Run("r2v video edit", func(t *testing.T) {
		body := `{"model":"Bach-1.0-Pro","prompt":"Replace sky in @Video1","duration":5,"resolution":"1080p","metadata":{"task_mode":"edit","video_url":"https://cdn.example.com/in.mp4"}}`
		payload, _, err := NormalizePayload([]byte(body))
		if err != nil {
			t.Fatalf("unexpected err: %v", err)
		}
		if payload.Input.Task != "r2v" || payload.Input.TaskMode != "edit" || len(payload.Input.ReferenceInputs) != 1 {
			t.Fatalf("unexpected edit payload: %+v", payload.Input)
		}
	})

	t.Run("rejects invalid inputs", func(t *testing.T) {
		cases := map[string]string{
			"unsupported model":  `{"model":"Bach-2.0","prompt":"p","duration":5,"resolution":"1080p"}`,
			"empty prompt":       `{"model":"Bach-1.0-Pro","prompt":"  ","duration":5,"resolution":"1080p"}`,
			"duration too short": `{"model":"Bach-1.0-Pro","prompt":"p","duration":4,"resolution":"1080p"}`,
			"duration too long":  `{"model":"Bach-1.0-Pro","prompt":"p","duration":17,"resolution":"1080p"}`,
			"unsupported 720p":   `{"model":"Bach-1.0-Pro","prompt":"p","duration":5,"resolution":"720p"}`,
			"audio only r2v":     `{"model":"Bach-1.0-Pro","prompt":"p","duration":5,"resolution":"1080p","audio":"https://cdn.example.com/a.mp3"}`,
			"base64 image":       `{"model":"Bach-1.0-Pro","prompt":"p","duration":5,"resolution":"1080p","first_frame":"data:image/png;base64,AAAA"}`,
		}
		for name, body := range cases {
			if _, _, err := NormalizePayload([]byte(body)); err == nil {
				t.Errorf("%s: expected error, got nil", name)
			}
		}
	})
}

func TestEstimateBillingWithAndWithoutReferenceVideo(t *testing.T) {
	gin.SetMode(gin.TestMode)
	a := &TaskAdaptor{}

	run := func(body string) float64 {
		w := httptest.NewRecorder()
		c, _ := gin.CreateTestContext(w)
		c.Request = httptest.NewRequest(http.MethodPost, "/v1/videos", strings.NewReader(body))
		info := &relaycommon.RelayInfo{
			ChannelMeta: &relaycommon.ChannelMeta{
				UpstreamModelName: ModelBach10Pro,
			},
			OriginModelName: ModelBach10Pro,
			TaskRelayInfo:   &relaycommon.TaskRelayInfo{},
		}
		info.PriceData.ModelPrice = 4.38 // 0.8760 * 5s official CNY list price
		if taskErr := a.ValidateRequestAndSetAction(c, info); taskErr != nil {
			t.Fatalf("validate failed: %+v", taskErr)
		}
		ratios := a.EstimateBilling(c, info)
		if ratios == nil || ratios["spec_price"] <= 0 {
			t.Fatalf("expected positive spec_price, got %v", ratios)
		}
		return ratios["spec_price"] * info.PriceData.ModelPrice
	}

	// 1080p 10s without ref video: 0.8760 * 10 = 8.76 CNY (before channel price_ratio 1.5 -> 13.14 CNY)
	got1080 := run(`{"model":"Bach-1.0-Pro","prompt":"p","duration":10,"resolution":"1080p"}`)
	if got1080 < 8.759 || got1080 > 8.761 {
		t.Fatalf("1080p 10s official CNY = %v, want 8.76", got1080)
	}

	// 4k 5s with 5s ref video: 1.7520 * (5 + 5) = 17.52 CNY (before channel price_ratio 1.5 -> 26.28 CNY)
	got4kRef := run(`{"model":"Bach-1.0-Pro","prompt":"p","duration":5,"resolution":"4k","metadata":{"billing_reference_video_duration_seconds":5,"content":[{"type":"video_url","video_url":{"url":"https://cdn.example.com/in.mp4"}}]}}`)
	if got4kRef < 17.519 || got4kRef > 17.521 {
		t.Fatalf("4k 5s+5s ref official CNY = %v, want 17.52", got4kRef)
	}
}

func TestDoResponseParseTaskResultAndConvertToOpenAIVideo(t *testing.T) {
	gin.SetMode(gin.TestMode)
	a := &TaskAdaptor{}

	// DoResponse
	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	info := &relaycommon.RelayInfo{
		OriginModelName: ModelBach10ProAds,
		TaskRelayInfo: &relaycommon.TaskRelayInfo{
			PublicTaskID: "task_pub_123",
		},
	}
	createBody := `{"code":200,"message":"Success","data":{"task_id":"550e8400-e29b-41d4-a716-446655440000","status":"TASK_PENDING","created_at":1778313600},"timestamp":1778313600}`
	resp := &http.Response{StatusCode: http.StatusOK, Body: io.NopCloser(strings.NewReader(createBody))}
	upstreamID, _, taskErr := a.DoResponse(c, resp, info)
	if taskErr != nil {
		t.Fatalf("DoResponse err: %+v", taskErr)
	}
	if upstreamID != "550e8400-e29b-41d4-a716-446655440000" {
		t.Fatalf("upstreamID=%q", upstreamID)
	}
	var ov dto.OpenAIVideo
	if err := json.Unmarshal(w.Body.Bytes(), &ov); err != nil {
		t.Fatalf("unmarshal response: %v", err)
	}
	if ov.ID != "task_pub_123" || ov.Model != ModelBach10ProAds {
		t.Fatalf("unexpected OpenAIVideo: %+v", ov)
	}

	// ParseTaskResult: SUCCEEDED
	okBody := `{"code":200,"message":"Success","data":{"task_id":"550e8400","status":"TASK_SUCCEEDED","video_url":"https://cdn.bach.art/out.mp4","usage":{"video_output":10}},"timestamp":1778313700}`
	ti, err := a.ParseTaskResult([]byte(okBody))
	if err != nil {
		t.Fatalf("ParseTaskResult succeeded err: %v", err)
	}
	if ti.Status != model.TaskStatusSuccess || ti.Url != "https://cdn.bach.art/out.mp4" || ti.OutputSeconds != 10 {
		t.Fatalf("unexpected TaskInfo: %+v", ti)
	}

	// ConvertToOpenAIVideo
	task := &model.Task{
		TaskID:   "task_pub_123",
		Status:   model.TaskStatusSuccess,
		Progress: "100%",
		Data:     []byte(okBody),
		Properties: model.Properties{
			OriginModelName: ModelBach10ProAds,
		},
	}
	converted, err := a.ConvertToOpenAIVideo(task)
	if err != nil {
		t.Fatalf("ConvertToOpenAIVideo err: %v", err)
	}
	if !strings.Contains(string(converted), "https://cdn.bach.art/out.mp4") || !strings.Contains(string(converted), "task_pub_123") {
		t.Fatalf("unexpected converted OpenAI video: %s", string(converted))
	}

	// ParseTaskResult: FAILED
	failBody := `{"code":200,"message":"Success","data":{"task_id":"550e8400","status":"TASK_FAILED","message":"Reference image unreachable","usage":{"video_output":0}},"timestamp":1778313700}`
	tiFail, err := a.ParseTaskResult([]byte(failBody))
	if err != nil {
		t.Fatalf("ParseTaskResult failed err: %v", err)
	}
	if tiFail.Status != model.TaskStatusFailure || tiFail.Reason != "Reference image unreachable" {
		t.Fatalf("unexpected failed TaskInfo: %+v", tiFail)
	}
}
