package gemini

import (
	"strings"
	"testing"

	relaycommon "github.com/QuantumNous/new-api/relay/common"
)

func TestGetRequestURLUsesBindingAPIVersion(t *testing.T) {
	info := &relaycommon.RelayInfo{
		ChannelMeta: &relaycommon.ChannelMeta{
			ChannelBaseUrl:    "https://generativelanguage.googleapis.com",
			UpstreamModelName: "gemini-2.5-flash",
			ProtocolOptions: map[string]string{
				"api_version": "v1",
			},
		},
	}

	requestURL, err := (&Adaptor{}).GetRequestURL(info)
	if err != nil {
		t.Fatalf("GetRequestURL() error = %v", err)
	}
	if !strings.Contains(requestURL, "/v1/models/gemini-2.5-flash:") {
		t.Fatalf("request URL did not use binding API version: %s", requestURL)
	}
}
