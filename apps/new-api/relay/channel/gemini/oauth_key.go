package gemini

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/dto"
	"github.com/QuantumNous/new-api/pkg/geminiauth"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
)

const defaultGeminiCodeAssistBaseURL = "https://cloudcode-pa.googleapis.com"

func geminiCodeAssistBaseURL(channelBaseURL string) string {
	if configuredBaseURL := strings.TrimRight(strings.TrimSpace(channelBaseURL), "/"); configuredBaseURL != "" {
		return configuredBaseURL
	}
	return strings.TrimRight(
		common.GetEnvOrDefaultString(
			"GEMINI_CODE_ASSIST_BASE_URL",
			defaultGeminiCodeAssistBaseURL,
		),
		"/",
	)
}

type GeminiOAuthKey = geminiauth.OAuthKey

func IsGeminiOAuthKey(raw string) bool {
	return geminiauth.IsOAuthKey(raw)
}

func ParseGeminiOAuthKey(raw string) (*GeminiOAuthKey, error) {
	return geminiauth.ParseOAuthKey(raw)
}

type geminiCodeAssistRequest struct {
	Model   string                 `json:"model"`
	Project string                 `json:"project"`
	Request *dto.GeminiChatRequest `json:"request"`
}

func isGeminiCodeAssistInfo(info *relaycommon.RelayInfo) bool {
	if info == nil {
		return false
	}
	key, err := geminiauth.ParseOAuthKey(info.ApiKey)
	return err == nil && key.IsCodeAssist()
}

func wrapGeminiCodeAssistRequest(info *relaycommon.RelayInfo, request *dto.GeminiChatRequest) (geminiCodeAssistRequest, error) {
	if info == nil || request == nil {
		return geminiCodeAssistRequest{}, errors.New("gemini code assist request is missing relay info or body")
	}
	key, err := geminiauth.ParseOAuthKey(info.ApiKey)
	if err != nil || !key.IsCodeAssist() {
		return geminiCodeAssistRequest{}, errors.New("gemini code assist request requires a Code Assist OAuth credential")
	}
	projectID := strings.TrimSpace(key.ProjectID)
	if projectID == "" {
		return geminiCodeAssistRequest{}, errors.New("gemini Code Assist credential is missing project_id")
	}
	return geminiCodeAssistRequest{
		Model:   info.UpstreamModelName,
		Project: projectID,
		Request: request,
	}, nil
}

func unwrapGeminiCodeAssistData(data string) (string, error) {
	var envelope struct {
		Response json.RawMessage `json:"response"`
	}
	if err := common.UnmarshalJsonStr(data, &envelope); err != nil {
		return data, nil
	}
	response := bytes.TrimSpace(envelope.Response)
	if len(response) == 0 || bytes.Equal(response, []byte("null")) {
		return data, nil
	}
	return string(response), nil
}

func unwrapGeminiCodeAssistResponseBody(resp *http.Response) error {
	if resp == nil || resp.Body == nil {
		return errors.New("gemini response body is missing")
	}
	body, err := io.ReadAll(resp.Body)
	closeErr := resp.Body.Close()
	if err != nil {
		return err
	}
	if closeErr != nil {
		return closeErr
	}
	unwrapped, err := unwrapGeminiCodeAssistData(string(body))
	if err != nil {
		return fmt.Errorf("unwrap Gemini Code Assist response: %w", err)
	}
	resp.Body = io.NopCloser(strings.NewReader(unwrapped))
	resp.ContentLength = int64(len(unwrapped))
	return nil
}
