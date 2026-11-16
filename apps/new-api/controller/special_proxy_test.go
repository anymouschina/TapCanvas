package controller

import (
	"bytes"
	"encoding/base64"
	"io"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/service"
	"github.com/gin-gonic/gin"
)

var removeBgTestPNG = []byte{0x89, 'P', 'N', 'G', 1, 2, 3}

// newLeonardoMock serves the sync endpoint and a result URL. syncReply decides what the
// sync endpoint answers; the parsed request body is captured for assertions.
func newLeonardoMock(t *testing.T, syncReply func(w http.ResponseWriter, r *http.Request)) (*httptest.Server, *map[string]any) {
	t.Helper()
	captured := map[string]any{}
	mux := http.NewServeMux()
	mux.HandleFunc("/api/rest/v2/generationssync", func(w http.ResponseWriter, r *http.Request) {
		if got := r.Header.Get("Authorization"); got != "Bearer leo-key" {
			t.Errorf("Authorization = %q, want Bearer leo-key", got)
		}
		if got := r.Header.Get("Content-Type"); got != "application/json" {
			t.Errorf("Content-Type = %q, want application/json", got)
		}
		raw, _ := io.ReadAll(r.Body)
		if err := common.Unmarshal(raw, &captured); err != nil {
			t.Errorf("request body is not JSON: %v", err)
		}
		syncReply(w, r)
	})
	mux.HandleFunc("/result.png", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "binary/octet-stream")
		_, _ = w.Write(removeBgTestPNG)
	})
	server := httptest.NewServer(mux)
	t.Cleanup(server.Close)
	return server, &captured
}

func newRemoveBgMultipartContext(t *testing.T, fields map[string]string, image []byte) (*gin.Context, *httptest.ResponseRecorder) {
	t.Helper()
	var buf bytes.Buffer
	form := multipart.NewWriter(&buf)
	if image != nil {
		part, err := form.CreateFormFile("image_file", "image.png")
		if err != nil {
			t.Fatal(err)
		}
		_, _ = part.Write(image)
	}
	for key, value := range fields {
		_ = form.WriteField(key, value)
	}
	_ = form.Close()

	gin.SetMode(gin.TestMode)
	recorder := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(recorder)
	c.Request = httptest.NewRequest(http.MethodPost, "/proxy/remove-bg/v1.0/removebg", &buf)
	c.Request.Header.Set("Content-Type", form.FormDataContentType())
	return c, recorder
}

func TestProxyLeonardoRemoveBgTranslatesRequestAndReturnsImageBytes(t *testing.T) {
	service.InitHttpClient()
	var server *httptest.Server
	server, captured := newLeonardoMock(t, func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"id":"gen-1","results":[{"url":"` + server.URL + `/result.png","contentType":"image/png"}]}`))
	})

	source := []byte("source image bytes")
	c, recorder := newRemoveBgMultipartContext(t, map[string]string{
		"size":           "auto",
		"crop":           "true",
		"shadow_opacity": "40",
		"add_shadow":     "true", // deprecated remove.bg option, must not be forwarded
	}, source)
	proxyLeonardoRemoveBg(c, "leo-key", "", server.URL+"/api/rest/v2/generationssync")

	if recorder.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", recorder.Code, recorder.Body.String())
	}
	if got := recorder.Header().Get("Content-Type"); got != "image/png" {
		t.Fatalf("Content-Type = %q, want image/png", got)
	}
	if !bytes.Equal(recorder.Body.Bytes(), removeBgTestPNG) {
		t.Fatalf("body = %v, want the downloaded PNG", recorder.Body.Bytes())
	}

	body := *captured
	if body["model"] != "remove-bg" || body["ephemeral"] != true {
		t.Fatalf("model/ephemeral not set: %v", body)
	}
	params, _ := body["parameters"].(map[string]any)
	if params["size"] != "auto" || params["crop"] != true || params["shadow_opacity"] != float64(40) {
		t.Fatalf("options not mapped under parameters: %v", params)
	}
	if _, ok := params["add_shadow"]; ok {
		t.Fatalf("unsupported option forwarded: %v", params)
	}
	guidances, _ := params["guidances"].(map[string]any)
	refs, _ := guidances["image_reference"].([]any)
	if len(refs) != 1 {
		t.Fatalf("image_reference = %v", guidances)
	}
	image, _ := refs[0].(map[string]any)["image"].(map[string]any)
	if image["type"] != "BASE64" || image["data"] != base64.StdEncoding.EncodeToString(source) {
		t.Fatalf("image not sent as BASE64: %v", image)
	}
}

func TestProxyLeonardoRemoveBgTurnsErrorsIntoNon2xx(t *testing.T) {
	service.InitHttpClient()
	server, _ := newLeonardoMock(t, func(w http.ResponseWriter, r *http.Request) {
		// Leonardo usually reports errors as HTTP 200 with errors[].
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"errors":[{"message":"Invalid image","extensions":{"code":"BAD_REQUEST"}}]}`))
	})

	c, recorder := newRemoveBgMultipartContext(t, map[string]string{"size": "auto"}, []byte("x"))
	proxyLeonardoRemoveBg(c, "leo-key", "", server.URL+"/api/rest/v2/generationssync")

	if recorder.Code != http.StatusBadGateway {
		t.Fatalf("status = %d, want %d", recorder.Code, http.StatusBadGateway)
	}
	if !bytes.Contains(recorder.Body.Bytes(), []byte("Invalid image")) {
		t.Fatalf("body = %s, want the Leonardo error message", recorder.Body.String())
	}
}

func TestProxyLeonardoRemoveBgRejectsUnsupportedRequests(t *testing.T) {
	service.InitHttpClient()
	server, _ := newLeonardoMock(t, func(w http.ResponseWriter, r *http.Request) {
		t.Error("Leonardo must not be called for an invalid request")
	})

	c, recorder := newRemoveBgMultipartContext(t, map[string]string{"format": "zip"}, []byte("x"))
	proxyLeonardoRemoveBg(c, "leo-key", "", server.URL+"/api/rest/v2/generationssync")
	if recorder.Code != http.StatusBadRequest {
		t.Fatalf("format=zip: status = %d, want 400", recorder.Code)
	}

	c, recorder = newRemoveBgMultipartContext(t, map[string]string{"size": "auto"}, nil)
	proxyLeonardoRemoveBg(c, "leo-key", "", server.URL+"/api/rest/v2/generationssync")
	if recorder.Code != http.StatusBadRequest {
		t.Fatalf("missing image: status = %d, want 400", recorder.Code)
	}
}

func TestProxyRemoveBgOnlyServesRemoveBgPath(t *testing.T) {
	gin.SetMode(gin.TestMode)
	recorder := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(recorder)
	c.Request = httptest.NewRequest(http.MethodGet, "/proxy/remove-bg/v1.0/account", nil)
	c.Params = gin.Params{{Key: "path", Value: "/v1.0/account"}}

	ProxyRemoveBg(c)
	if recorder.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want 404", recorder.Code)
	}
}
