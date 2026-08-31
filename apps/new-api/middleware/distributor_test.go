package middleware

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	appI18n "github.com/QuantumNous/new-api/i18n"
	"github.com/gin-gonic/gin"
)

func initializeDistributorTest(t *testing.T) {
	t.Helper()
	if err := appI18n.Init(); err != nil {
		t.Fatalf("initialize i18n: %v", err)
	}
}

func TestNormalizeRequestedModelNamePreservesProviderSpecificKey(t *testing.T) {
	t.Parallel()

	original, routing := normalizeRequestedModelName("nanobanana2-suchuang")
	if original != "nanobanana2-suchuang" {
		t.Fatalf("original = %q, want %q", original, "nanobanana2-suchuang")
	}
	if routing != "nanobanana2" {
		t.Fatalf("routing = %q, want %q", routing, "nanobanana2")
	}
}

func TestNormalizeRequestedModelNameKeepsCanonicalAliasStable(t *testing.T) {
	t.Parallel()

	original, routing := normalizeRequestedModelName("nanobanana2")
	if original != "nanobanana2" {
		t.Fatalf("original = %q, want %q", original, "nanobanana2")
	}
	if routing != "nanobanana2" {
		t.Fatalf("routing = %q, want %q", routing, "nanobanana2")
	}
}

func TestDistributeBypassesChannelResolutionForPersistedTaskRoutes(t *testing.T) {
	initializeDistributorTest(t)

	testCases := []struct {
		name   string
		method string
		path   string
	}{
		{name: "OpenAI video fetch", method: http.MethodGet, path: "/v1/videos/task_test"},
		{name: "legacy video fetch", method: http.MethodGet, path: "/v1/video/generations/task_test"},
		{name: "origin-bound video remix", method: http.MethodPost, path: "/v1/videos/task_test/remix"},
		{name: "Suno fetch by id", method: http.MethodGet, path: "/suno/fetch/task_test"},
		{name: "Suno fetch by condition", method: http.MethodPost, path: "/suno/fetch"},
		{name: "Midjourney task fetch", method: http.MethodGet, path: "/mj/task/task_test/fetch"},
		{name: "Midjourney image seed", method: http.MethodGet, path: "/mj/task/task_test/image-seed"},
		{name: "Midjourney fetch by condition", method: http.MethodPost, path: "/mj/task/list-by-condition"},
	}

	for _, testCase := range testCases {
		t.Run(testCase.name, func(t *testing.T) {
			reachedHandler := false
			router := gin.New()
			router.Use(Distribute())
			router.Any("/*path", func(c *gin.Context) {
				reachedHandler = true
				c.Status(http.StatusNoContent)
			})

			response := httptest.NewRecorder()
			request := httptest.NewRequest(testCase.method, testCase.path, nil)
			router.ServeHTTP(response, request)

			if !reachedHandler {
				t.Fatalf("downstream handler was not reached; status=%d body=%s", response.Code, response.Body.String())
			}
			if response.Code != http.StatusNoContent {
				t.Fatalf("status = %d, want %d; body=%s", response.Code, http.StatusNoContent, response.Body.String())
			}
		})
	}
}

func TestDistributePersistedTaskFetchIgnoresModelSelectionConstraints(t *testing.T) {
	initializeDistributorTest(t)

	reachedHandler := false
	router := gin.New()
	router.Use(func(c *gin.Context) {
		common.SetContextKey(c, constant.ContextKeyTokenModelLimitEnabled, true)
		c.Next()
	})
	router.Use(Distribute())
	router.GET("/v1/videos/:task_id", func(c *gin.Context) {
		reachedHandler = true
		c.Status(http.StatusNoContent)
	})

	response := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodGet, "/v1/videos/task_test", nil)
	router.ServeHTTP(response, request)

	if !reachedHandler {
		t.Fatalf("downstream handler was not reached; status=%d body=%s", response.Code, response.Body.String())
	}
	if response.Code != http.StatusNoContent {
		t.Fatalf("status = %d, want %d; body=%s", response.Code, http.StatusNoContent, response.Body.String())
	}
}

func TestDistributeStillRejectsChannelSelectedRequestWithoutModel(t *testing.T) {
	initializeDistributorTest(t)

	reachedHandler := false
	router := gin.New()
	router.Use(Distribute())
	router.POST("/v1/videos", func(c *gin.Context) {
		reachedHandler = true
		c.Status(http.StatusNoContent)
	})

	response := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodPost, "/v1/videos", strings.NewReader(`{"prompt":"test"}`))
	request.Header.Set("Content-Type", "application/json")
	router.ServeHTTP(response, request)

	if reachedHandler {
		t.Fatal("downstream handler must not be reached when a channel-selected request has no model")
	}
	if response.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want %d; body=%s", response.Code, http.StatusBadRequest, response.Body.String())
	}
}
