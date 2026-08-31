package middleware

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/model"
	"github.com/gin-gonic/gin"
)

func officialGeminiChannelFixture() *model.Channel {
	baseURL := constant.GoogleGeminiOfficialBaseURL
	settings := `{"default_protocol":{"protocol":"gemini"},"proxy":""}`
	return &model.Channel{
		Id:      401,
		Type:    constant.ChannelTypeGemini,
		Key:     "test-google-api-key",
		Status:  common.ChannelStatusEnabled,
		Name:    constant.GoogleGeminiOfficialChannelName,
		BaseURL: &baseURL,
		Models:  "gemini-3.1-pro-preview",
		Setting: &settings,
		AutoBan: common.GetPointer(0),
	}
}

func TestValidateForcedOfficialGeminiChannel(t *testing.T) {
	channel := officialGeminiChannelFixture()
	if err := validateForcedOfficialGeminiChannel(channel, "gemini-3.1-pro-preview"); err != nil {
		t.Fatalf("valid official channel rejected: %v", err)
	}
}

func TestValidateForcedOfficialGeminiChannelRejectsCloudflareEndpoint(t *testing.T) {
	channel := officialGeminiChannelFixture()
	cloudflareURL := "https://generativelanguage.beqlee.icu"
	channel.BaseURL = &cloudflareURL
	if err := validateForcedOfficialGeminiChannel(channel, "gemini-3.1-pro-preview"); err == nil || !strings.Contains(err.Error(), "Base URL") {
		t.Fatalf("Cloudflare endpoint error = %v, want explicit Base URL failure", err)
	}
}

func TestValidateForcedOfficialGeminiChannelRejectsModelMappingAndProxy(t *testing.T) {
	channel := officialGeminiChannelFixture()
	mapping := `{"gemini-3.1-pro-preview":"vendor-model"}`
	channel.ModelMapping = &mapping
	if err := validateForcedOfficialGeminiChannel(channel, "gemini-3.1-pro-preview"); err == nil || !strings.Contains(err.Error(), "model_mapping") {
		t.Fatalf("model mapping error = %v, want identity-model failure", err)
	}

	channel = officialGeminiChannelFixture()
	settings := `{"default_protocol":{"protocol":"gemini"},"proxy":"http://proxy.example"}`
	channel.Setting = &settings
	if err := validateForcedOfficialGeminiChannel(channel, "gemini-3.1-pro-preview"); err == nil || !strings.Contains(err.Error(), "渠道代理") {
		t.Fatalf("proxy error = %v, want direct-connect failure", err)
	}
}

func TestSetupContextClearsModelMappingForForcedOfficialGemini(t *testing.T) {
	gin.SetMode(gin.TestMode)
	ctx, _ := gin.CreateTestContext(nil)
	channel := officialGeminiChannelFixture()
	mapping := `{"gemini-3.1-pro-preview":"vendor-model"}`
	channel.ModelMapping = &mapping
	markForcedOfficialGeminiRoute(ctx, channel)

	if err := SetupContextForSelectedChannel(ctx, channel, "gemini-3.1-pro-preview"); err != nil {
		t.Fatalf("SetupContextForSelectedChannel returned error: %v", err)
	}
	if mapping := common.GetContextKeyString(ctx, constant.ContextKeyChannelModelMapping); mapping != "" {
		t.Fatalf("forced official model mapping = %q, want identity mapping", mapping)
	}
}

func TestTokenAllowsRequestedModelForForcedOfficialRoute(t *testing.T) {
	gin.SetMode(gin.TestMode)
	response := httptest.NewRecorder()
	ctx, _ := gin.CreateTestContext(response)
	ctx.Request = httptest.NewRequest(http.MethodPost, "/v1/chat/completions", nil)
	common.SetContextKey(ctx, constant.ContextKeyTokenModelLimitEnabled, true)
	common.SetContextKey(ctx, constant.ContextKeyTokenModelLimit, map[string]bool{
		"gemini-3.1-pro-preview": true,
	})

	if !tokenAllowsRequestedModel(ctx, "gemini-3.1-pro-preview", "gemini-3.1-pro-preview") {
		t.Fatal("forced official route rejected a token-authorized Gemini model")
	}
}

func TestTokenRejectsUnauthorizedModelBeforeForcedOfficialRoute(t *testing.T) {
	gin.SetMode(gin.TestMode)
	response := httptest.NewRecorder()
	ctx, _ := gin.CreateTestContext(response)
	ctx.Request = httptest.NewRequest(http.MethodPost, "/v1/chat/completions", nil)
	common.SetContextKey(ctx, constant.ContextKeyTokenModelLimitEnabled, true)
	common.SetContextKey(ctx, constant.ContextKeyTokenModelLimit, map[string]bool{
		"gemini-2.5-flash": true,
	})

	if tokenAllowsRequestedModel(ctx, "gemini-3.1-pro-preview", "gemini-3.1-pro-preview") {
		t.Fatal("forced official route expanded the token's allowed model set")
	}
	if response.Code != http.StatusForbidden {
		t.Fatalf("unauthorized model status = %d, want %d", response.Code, http.StatusForbidden)
	}
}
