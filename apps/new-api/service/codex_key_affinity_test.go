package service

import (
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
)

func TestCodexSessionAffinityBinding(t *testing.T) {
	gin.SetMode(gin.TestMode)
	ctx, _ := gin.CreateTestContext(nil)
	ctx.Request = httptest.NewRequest("POST", "/v1/responses", nil)
	ctx.Request.Header.Set("Session_id", "session-a")
	if got := CodexSessionID(ctx); got != "session-a" {
		t.Fatalf("CodexSessionID = %q", got)
	}
	BindCodexSessionKey(92001, gotSessionID(ctx), 2, 3600)
	index, found := GetCodexSessionKeyIndex(92001, "session-a")
	if !found || index != 2 {
		t.Fatalf("affinity binding = %d/%v", index, found)
	}
	if _, found := GetCodexSessionKeyIndex(92002, "session-a"); found {
		t.Fatal("affinity binding leaked across channels")
	}
}

func gotSessionID(ctx *gin.Context) string {
	return CodexSessionID(ctx)
}
