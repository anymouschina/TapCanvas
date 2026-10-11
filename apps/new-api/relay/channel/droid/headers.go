package droid

import (
	"errors"
	"net/http"
	"strings"

	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/relay/channel"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
)

func option(info *relaycommon.RelayInfo, key, wireDefault string) string {
	if value := info.ProtocolOptions[key]; value != "" {
		return value
	}
	return wireDefault
}

func fastMode(info *relaycommon.RelayInfo) (bool, error) {
	switch info.ProtocolOptions["fast"] {
	case "", "false":
		return false, nil
	case "true":
		return true, nil
	default:
		return false, errors.New("droid: fast protocol option must be true or false")
	}
}

func clientHeader(c *gin.Context, name string) string {
	if c == nil || c.Request == nil {
		return ""
	}
	return c.Request.Header.Get(name)
}

// Reuse the caller's explicit conversation identifier. Requests without a
// conversation identifier receive a fresh Factory session.
func factorySessionID(c *gin.Context) string {
	if value := clientHeader(c, "x-session-id"); value != "" {
		return value
	}
	return uuid.NewString()
}

func (a *Adaptor) SetupRequestHeader(c *gin.Context, header *http.Header, info *relaycommon.RelayInfo) error {
	if info == nil || info.ChannelMeta == nil || strings.TrimSpace(info.ApiKey) == "" {
		return errors.New("droid: Factory API key is required")
	}
	fast, err := fastMode(info)
	if err != nil {
		return err
	}
	if c != nil && c.Request != nil {
		channel.SetupApiRequestHeader(info, c, header)
	}
	header.Set("Content-Type", "application/json")
	header.Set("Authorization", "Bearer "+info.ApiKey)
	header.Del("x-api-key")
	header.Del("x-goog-api-key")
	provider := "openai"
	switch a.ProtocolID {
	case constant.ProtocolDroidAnthropic:
		provider = "anthropic"
	case constant.ProtocolDroidGemini:
		provider = "google"
	case constant.ProtocolDroidChat:
		provider = "fireworks"
	}
	provider = option(info, "provider", provider)
	header.Set("x-api-provider", provider)
	if provider == "openai" {
		header.Set("OpenAI-Platform", OpenAIPlatform)
	}
	header.Set("x-factory-client", "cli")
	header.Set("User-Agent", option(info, "user_agent", DefaultUserAgent))
	header.Set("x-client-version", option(info, "client_version", DefaultClientVersion))
	header.Set("x-provider-routing-source", "registry_default")
	sessionID := factorySessionID(c)
	header.Set("x-session-id", sessionID)
	messageID := clientHeader(c, "x-assistant-message-id")
	if messageID == "" {
		messageID = uuid.NewString()
	}
	header.Set("x-assistant-message-id", messageID)
	if a.ProtocolID == constant.ProtocolDroidGemini {
		return nil
	}
	// The inspected Factory CLI wire includes these SDK metadata headers.
	defaults := map[string]string{"x-stainless-arch": "x64", "x-stainless-lang": "js", "x-stainless-os": "MacOS", "x-stainless-runtime": "node", "x-stainless-retry-count": "0", "x-stainless-runtime-version": "v24.3.0", "x-stainless-package-version": "5.23.2"}
	if a.ProtocolID == constant.ProtocolDroidAnthropic {
		defaults["x-stainless-package-version"] = "0.57.0"
		header.Set("x-api-key", "placeholder") // Factory authorization is the Bearer key.
		version := clientHeader(c, "anthropic-version")
		if version == "" {
			version = "2023-06-01"
		}
		header.Set("anthropic-version", option(info, "anthropic_version", version))
		header.Set("x-stainless-timeout", "600")
		if info.IsStream {
			header.Set("x-stainless-helper-method", "stream")
		}
		beta := clientHeader(c, "anthropic-beta")
		if fast {
			values := strings.Split(beta, ",")
			found := false
			for _, value := range values {
				if strings.TrimSpace(value) == "fast-mode-2026-02-01" {
					found = true
				}
			}
			if !found {
				if beta != "" {
					beta += ", "
				}
				beta += "fast-mode-2026-02-01"
			}
		}
		if beta != "" {
			header.Set("anthropic-beta", beta)
		}
	}
	for name, wireDefault := range defaults {
		value := clientHeader(c, name)
		if value == "" {
			value = wireDefault
		}
		header.Set(name, value)
	}
	return nil
}
