package apimart

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/dto"
	"github.com/QuantumNous/new-api/model"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	relayconstant "github.com/QuantumNous/new-api/relay/constant"
	"github.com/QuantumNous/new-api/service"
	"github.com/gin-gonic/gin"
	"github.com/glebarez/sqlite"
	"gorm.io/gorm"
)

func TestConvertImageRequestForwardsTypedQuality(t *testing.T) {
	db, err := gorm.Open(sqlite.Open("file:"+t.Name()+"?mode=memory&cache=shared"), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	for _, statement := range []string{
		`CREATE TABLE abilities ("group" text, model text, channel_id integer, enabled integer, priority integer, weight integer, tag text)`,
		`CREATE TABLE channels (id integer, setting text)`,
		`CREATE TABLE models (id integer, model_name text, status integer, pricing_config text, name_rule integer, deleted_at datetime)`,
		`CREATE TABLE vendors (id integer, name text, description text, icon text)`,
	} {
		if err := db.Exec(statement).Error; err != nil {
			t.Fatal(err)
		}
	}
	previousDB := model.DB
	model.DB = db
	t.Cleanup(func() { model.DB = previousDB })

	gin.SetMode(gin.TestMode)
	c, _ := gin.CreateTestContext(httptest.NewRecorder())
	info := &relaycommon.RelayInfo{
		ChannelMeta: &relaycommon.ChannelMeta{UpstreamModelName: "gpt-image-2"},
	}

	converted, err := (&Adaptor{}).ConvertImageRequest(c, info, dto.ImageRequest{
		Model:   "gpt-image-2",
		Prompt:  "an apple",
		Quality: "medium",
	})
	if err != nil {
		t.Fatal(err)
	}
	body, err := common.Marshal(converted)
	if err != nil {
		t.Fatal(err)
	}
	var payload map[string]any
	if err := common.Unmarshal(body, &payload); err != nil {
		t.Fatal(err)
	}
	if payload["quality"] != "medium" {
		t.Fatalf("quality = %#v, want medium; payload=%s", payload["quality"], body)
	}
}

// toapis can acknowledge a real asynchronous image task with HTTP 503. The
// APIMart image wrapper must follow the structured task acknowledgement and
// poll it, while preserving an ordinary non-2xx response as a provider error.
func TestDoAsyncImageAcceptsStructuredTaskOnNonSuccessStatus(t *testing.T) {
	gin.SetMode(gin.TestMode)
	service.InitHttpClient()

	t.Run("accepted flat task is polled to completion", func(t *testing.T) {
		pollCount := 0
		upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			switch {
			case r.Method == http.MethodPost && r.URL.Path == "/v1/images/generations":
				w.Header().Set("Content-Type", "application/json")
				w.WriteHeader(http.StatusServiceUnavailable)
				_, _ = w.Write([]byte(`{"id":"tsk_img_pending","object":"generation.task","status":"pending","progress":0}`))
			case r.Method == http.MethodGet && r.URL.Path == "/v1/images/generations/tsk_img_pending":
				pollCount++
				w.Header().Set("Content-Type", "application/json")
				_, _ = w.Write([]byte(`{"id":"tsk_img_pending","object":"generation.task","status":"completed","progress":100,"result":{"type":"image","data":[{"url":"https://files.example/result.png"}]}}`))
			default:
				t.Logf("unexpected request: %s %s", r.Method, r.URL.Path)
				http.NotFound(w, r)
			}
		}))
		defer upstream.Close()

		ctx, _ := gin.CreateTestContext(httptest.NewRecorder())
		ctx.Request = httptest.NewRequest(http.MethodPost, "/v1/images/generations", nil).WithContext(context.Background())
		info := &relaycommon.RelayInfo{
			ChannelMeta: &relaycommon.ChannelMeta{
				ChannelBaseUrl: upstream.URL,
				ApiKey:         "test-key",
			},
			RelayMode: relayconstant.RelayModeImagesGenerations,
		}

		result, err := (&Adaptor{}).doAsyncImage(ctx, info, http.NoBody)
		if err != nil {
			t.Fatal(err)
		}
		resp, ok := result.(*http.Response)
		if !ok {
			t.Fatalf("result type = %T, want *http.Response", result)
		}
		defer resp.Body.Close()
		if resp.StatusCode != http.StatusOK {
			t.Fatalf("status = %d, want 200", resp.StatusCode)
		}
		if pollCount != 1 {
			t.Fatalf("pollCount = %d, want 1", pollCount)
		}
	})

	t.Run("ordinary non-success response remains a provider error", func(t *testing.T) {
		upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusServiceUnavailable)
			_, _ = w.Write([]byte(`{"error":{"code":"provider_unavailable","message":"try later"}}`))
		}))
		defer upstream.Close()

		ctx, _ := gin.CreateTestContext(httptest.NewRecorder())
		ctx.Request = httptest.NewRequest(http.MethodPost, "/v1/images/generations", nil).WithContext(context.Background())
		info := &relaycommon.RelayInfo{
			ChannelMeta: &relaycommon.ChannelMeta{
				ChannelBaseUrl: upstream.URL,
				ApiKey:         "test-key",
			},
			RelayMode: relayconstant.RelayModeImagesGenerations,
		}

		result, err := (&Adaptor{}).doAsyncImage(ctx, info, http.NoBody)
		if err != nil {
			t.Fatal(err)
		}
		resp, ok := result.(*http.Response)
		if !ok {
			t.Fatalf("result type = %T, want *http.Response", result)
		}
		defer resp.Body.Close()
		if resp.StatusCode != http.StatusServiceUnavailable {
			t.Fatalf("status = %d, want 503", resp.StatusCode)
		}
	})
}

func TestDoAsyncImageAcceptsNewAPIAIImageTaskEnvelope(t *testing.T) {
	gin.SetMode(gin.TestMode)
	service.InitHttpClient()
	pollCount := 0
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.Method == http.MethodPost && r.URL.Path == "/v1/images/generations":
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"id":"task_newapiai","task_id":"task_newapiai","object":"image.task","status":"queued"}`))
		case r.Method == http.MethodGet && r.URL.Path == "/v1/images/generations/task_newapiai":
			pollCount++
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"id":"task_newapiai","task_id":"task_newapiai","object":"image.task","status":"completed","progress":"100%","result_url":"https://files.example/newapiai.png","data":{"data":[{"url":"https://files.example/nested.png"}]}}`))
		default:
			t.Logf("unexpected request: %s %s", r.Method, r.URL.Path)
			http.NotFound(w, r)
		}
	}))
	defer upstream.Close()

	recorder := httptest.NewRecorder()
	ctx, _ := gin.CreateTestContext(recorder)
	ctx.Request = httptest.NewRequest(http.MethodPost, "/v1/images/generations", nil).WithContext(context.Background())
	info := &relaycommon.RelayInfo{ChannelMeta: &relaycommon.ChannelMeta{
		ChannelBaseUrl: upstream.URL,
		ApiKey:         "test-key",
	}, RelayMode: relayconstant.RelayModeImagesGenerations}

	result, err := (&Adaptor{}).doAsyncImage(ctx, info, http.NoBody)
	if err != nil {
		t.Fatal(err)
	}
	resp, ok := result.(*http.Response)
	if !ok {
		t.Fatalf("result type = %T, want *http.Response", result)
	}
	usage, responseErr := (&Adaptor{}).finishAsyncImage(ctx, resp, info)
	if responseErr != nil {
		t.Fatal(responseErr)
	}
	if usage == nil {
		t.Fatal("usage is nil")
	}
	if pollCount != 1 {
		t.Fatalf("pollCount = %d, want 1", pollCount)
	}
	if body := recorder.Body.String(); !strings.Contains(body, `"url":"https://files.example/newapiai.png"`) {
		t.Fatalf("response body = %s", body)
	}
}
