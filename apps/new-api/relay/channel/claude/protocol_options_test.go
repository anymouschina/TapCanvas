package claude

import (
	"net/http"
	"net/http/httptest"
	"testing"

	relaycommon "github.com/QuantumNous/new-api/relay/common"
	"github.com/gin-gonic/gin"
)

func TestSetupRequestHeaderUsesBindingAnthropicVersion(t *testing.T) {
	gin.SetMode(gin.TestMode)
	ctx, _ := gin.CreateTestContext(httptest.NewRecorder())
	ctx.Request = httptest.NewRequest(http.MethodPost, "/v1/messages", nil)
	headers := http.Header{}
	info := &relaycommon.RelayInfo{
		ChannelMeta: &relaycommon.ChannelMeta{
			ApiKey: "test-key",
			ProtocolOptions: map[string]string{
				"anthropic_version": "2024-10-22",
			},
		},
	}

	if err := (&Adaptor{}).SetupRequestHeader(ctx, &headers, info); err != nil {
		t.Fatalf("SetupRequestHeader() error = %v", err)
	}
	if got := headers.Get("anthropic-version"); got != "2024-10-22" {
		t.Fatalf("anthropic-version = %q", got)
	}
}
