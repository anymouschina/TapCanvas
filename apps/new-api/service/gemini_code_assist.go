package service

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/QuantumNous/new-api/common"
)

const (
	defaultGeminiCodeAssistServiceBaseURL = "https://cloudcode-pa.googleapis.com"
	defaultGeminiCodeAssistDailyBaseURL   = "https://daily-cloudcode-pa.googleapis.com"
	geminiCodeAssistAPIVersion            = "v1internal"
	geminiCodeAssistOnboardAttempts       = 5
	geminiCodeAssistOnboardPollInterval   = 2 * time.Second
	geminiAntigravityNodeUserAgent        = geminiAntigravityUserAgent + " google-api-nodejs-client/10.3.0"
	geminiAntigravityGoogleAPIClient      = "gl-node/22.21.1"
)

type geminiCodeAssistLoadRequest struct {
	Metadata geminiCodeAssistLoadMetadata `json:"metadata"`
}

type geminiCodeAssistLoadMetadata struct {
	IDEType string `json:"ideType"`
}

type geminiCodeAssistTier struct {
	ID        string `json:"id"`
	IsDefault bool   `json:"isDefault"`
}

type geminiCodeAssistLoadResponse struct {
	CloudaicompanionProject json.RawMessage          `json:"cloudaicompanionProject"`
	ProjectID               string                   `json:"projectId"`
	Project                 json.RawMessage          `json:"project"`
	AllowedTiers            []geminiCodeAssistTier   `json:"allowedTiers"`
	CurrentTier             geminiCodeAssistTier     `json:"currentTier"`
	PaidTier                geminiCodeAssistPaidTier `json:"paidTier"`
}

type geminiCodeAssistPaidTier struct {
	ID               string                            `json:"id"`
	AvailableCredits []geminiCodeAssistAvailableCredit `json:"availableCredits"`
}

type geminiCodeAssistAvailableCredit struct {
	CreditType                  string `json:"creditType"`
	CreditAmount                string `json:"creditAmount"`
	MinimumCreditAmountForUsage string `json:"minimumCreditAmountForUsage"`
}

type geminiCodeAssistProjectReference struct {
	ID string `json:"id"`
}

type geminiCodeAssistOnboardRequest struct {
	TierID   string                          `json:"tier_id"`
	Metadata geminiCodeAssistOnboardMetadata `json:"metadata"`
}

type geminiCodeAssistOnboardMetadata struct {
	IDEType    string `json:"ide_type"`
	IDEVersion string `json:"ide_version"`
	IDEName    string `json:"ide_name"`
}

type geminiCodeAssistOnboardResponse struct {
	Done     bool `json:"done"`
	Response struct {
		CloudaicompanionProject json.RawMessage `json:"cloudaicompanionProject"`
		ProjectID               string          `json:"projectId"`
		Project                 json.RawMessage `json:"project"`
	} `json:"response"`
}

func geminiCodeAssistServiceBaseURL() string {
	return strings.TrimRight(
		common.GetEnvOrDefaultString("GEMINI_CODE_ASSIST_BASE_URL", defaultGeminiCodeAssistServiceBaseURL),
		"/",
	)
}

func geminiCodeAssistDailyBaseURL() string {
	return strings.TrimRight(
		common.GetEnvOrDefaultString("GEMINI_CODE_ASSIST_DAILY_BASE_URL", defaultGeminiCodeAssistDailyBaseURL),
		"/",
	)
}

// FetchGeminiAntigravityProjectID mirrors CLIProxyAPI's Antigravity account
// preparation contract: load the existing Code Assist project, or explicitly
// onboard the account and wait until Google returns the new project.
func FetchGeminiAntigravityProjectID(ctx context.Context, accessToken string, proxyURL string) (string, error) {
	token := strings.TrimSpace(accessToken)
	if token == "" {
		return "", errors.New("Gemini Antigravity project discovery requires access_token")
	}
	client, err := getGeminiOAuthHTTPClient(proxyURL)
	if err != nil {
		return "", err
	}
	loadResponse, err := loadGeminiCodeAssistAccount(ctx, client, token)
	if err != nil {
		return "", err
	}
	projectID, err := extractGeminiCodeAssistLoadProject(loadResponse)
	if err != nil {
		return "", err
	}
	if projectID != "" {
		return projectID, nil
	}
	return onboardGeminiCodeAssistAccount(ctx, client, token, defaultGeminiCodeAssistTier(loadResponse))
}

func loadGeminiCodeAssistAccount(ctx context.Context, client *http.Client, accessToken string) (*geminiCodeAssistLoadResponse, error) {
	return loadGeminiCodeAssistAccountAtBaseURL(ctx, client, accessToken, geminiCodeAssistServiceBaseURL())
}

func loadGeminiCodeAssistAccountAtBaseURL(ctx context.Context, client *http.Client, accessToken string, baseURL string) (*geminiCodeAssistLoadResponse, error) {
	payload, err := common.Marshal(geminiCodeAssistLoadRequest{
		Metadata: geminiCodeAssistLoadMetadata{IDEType: "ANTIGRAVITY"},
	})
	if err != nil {
		return nil, fmt.Errorf("encode Gemini Antigravity loadCodeAssist request: %w", err)
	}
	endpoint := fmt.Sprintf("%s/%s:loadCodeAssist", strings.TrimRight(strings.TrimSpace(baseURL), "/"), geminiCodeAssistAPIVersion)
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, bytes.NewReader(payload))
	if err != nil {
		return nil, fmt.Errorf("create Gemini Antigravity loadCodeAssist request: %w", err)
	}
	setGeminiAntigravityControlPlaneHeaders(request, accessToken, false)
	body, err := executeGeminiCodeAssistRequest(client, request, "loadCodeAssist")
	if err != nil {
		return nil, err
	}
	var response geminiCodeAssistLoadResponse
	if err := common.Unmarshal(body, &response); err != nil {
		return nil, fmt.Errorf("decode Gemini Antigravity loadCodeAssist response: %w", err)
	}
	return &response, nil
}

func onboardGeminiCodeAssistAccount(ctx context.Context, client *http.Client, accessToken string, tierID string) (string, error) {
	payload, err := common.Marshal(geminiCodeAssistOnboardRequest{
		TierID: tierID,
		Metadata: geminiCodeAssistOnboardMetadata{
			IDEType:    "ANTIGRAVITY",
			IDEVersion: "2.2.1",
			IDEName:    "antigravity",
		},
	})
	if err != nil {
		return "", fmt.Errorf("encode Gemini Antigravity onboardUser request: %w", err)
	}
	endpoint := fmt.Sprintf("%s/%s:onboardUser", geminiCodeAssistDailyBaseURL(), geminiCodeAssistAPIVersion)
	for attempt := 1; attempt <= geminiCodeAssistOnboardAttempts; attempt++ {
		request, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, bytes.NewReader(payload))
		if err != nil {
			return "", fmt.Errorf("create Gemini Antigravity onboardUser request: %w", err)
		}
		setGeminiAntigravityControlPlaneHeaders(request, accessToken, true)
		body, err := executeGeminiCodeAssistRequest(client, request, "onboardUser")
		if err != nil {
			return "", err
		}
		var response geminiCodeAssistOnboardResponse
		if err := common.Unmarshal(body, &response); err != nil {
			return "", fmt.Errorf("decode Gemini Antigravity onboardUser response: %w", err)
		}
		if response.Done {
			projectID, err := extractGeminiCodeAssistOnboardProject(&response)
			if err != nil {
				return "", err
			}
			if projectID == "" {
				return "", errors.New("Gemini Antigravity onboardUser completed without project_id")
			}
			return projectID, nil
		}
		if attempt == geminiCodeAssistOnboardAttempts {
			break
		}
		timer := time.NewTimer(geminiCodeAssistOnboardPollInterval)
		select {
		case <-ctx.Done():
			if !timer.Stop() {
				<-timer.C
			}
			return "", fmt.Errorf("Gemini Antigravity onboardUser canceled: %w", ctx.Err())
		case <-timer.C:
		}
	}
	return "", fmt.Errorf("Gemini Antigravity onboardUser did not complete after %d attempts", geminiCodeAssistOnboardAttempts)
}

func setGeminiAntigravityControlPlaneHeaders(request *http.Request, accessToken string, onboard bool) {
	request.Header.Set("Authorization", "Bearer "+accessToken)
	request.Header.Set("Accept", "*/*")
	request.Header.Set("Content-Type", "application/json")
	if onboard {
		request.Header.Set("User-Agent", geminiAntigravityNodeUserAgent)
		request.Header.Set("X-Goog-Api-Client", geminiAntigravityGoogleAPIClient)
		return
	}
	request.Header.Set("User-Agent", geminiAntigravityUserAgent)
}

func executeGeminiCodeAssistRequest(client *http.Client, request *http.Request, operation string) ([]byte, error) {
	response, err := client.Do(request)
	if err != nil {
		return nil, fmt.Errorf("Gemini Antigravity %s request failed: %w", operation, err)
	}
	body, readErr := io.ReadAll(response.Body)
	closeErr := response.Body.Close()
	if readErr != nil {
		return nil, fmt.Errorf("read Gemini Antigravity %s response: %w", operation, readErr)
	}
	if closeErr != nil {
		return nil, fmt.Errorf("close Gemini Antigravity %s response: %w", operation, closeErr)
	}
	if response.StatusCode < http.StatusOK || response.StatusCode >= http.StatusMultipleChoices {
		snippet := strings.TrimSpace(string(body))
		if len(snippet) > 500 {
			snippet = snippet[:500]
		}
		return nil, fmt.Errorf("Gemini Antigravity %s request failed: status=%d body=%s", operation, response.StatusCode, snippet)
	}
	return body, nil
}

func extractGeminiCodeAssistLoadProject(response *geminiCodeAssistLoadResponse) (string, error) {
	if response == nil {
		return "", nil
	}
	if projectID, err := decodeGeminiCodeAssistProject(response.CloudaicompanionProject); err != nil || projectID != "" {
		return projectID, err
	}
	if projectID := strings.TrimSpace(response.ProjectID); projectID != "" {
		return projectID, nil
	}
	return decodeGeminiCodeAssistProject(response.Project)
}

func extractGeminiCodeAssistOnboardProject(response *geminiCodeAssistOnboardResponse) (string, error) {
	if response == nil {
		return "", nil
	}
	if projectID, err := decodeGeminiCodeAssistProject(response.Response.CloudaicompanionProject); err != nil || projectID != "" {
		return projectID, err
	}
	if projectID := strings.TrimSpace(response.Response.ProjectID); projectID != "" {
		return projectID, nil
	}
	return decodeGeminiCodeAssistProject(response.Response.Project)
}

func decodeGeminiCodeAssistProject(raw json.RawMessage) (string, error) {
	trimmed := bytes.TrimSpace(raw)
	if len(trimmed) == 0 || bytes.Equal(trimmed, []byte("null")) {
		return "", nil
	}
	if trimmed[0] == '"' {
		var projectID string
		if err := common.Unmarshal(trimmed, &projectID); err != nil {
			return "", fmt.Errorf("decode Gemini Antigravity project_id: %w", err)
		}
		return strings.TrimSpace(projectID), nil
	}
	var project geminiCodeAssistProjectReference
	if err := common.Unmarshal(trimmed, &project); err != nil {
		return "", fmt.Errorf("decode Gemini Antigravity project reference: %w", err)
	}
	return strings.TrimSpace(project.ID), nil
}

func defaultGeminiCodeAssistTier(response *geminiCodeAssistLoadResponse) string {
	if response != nil {
		for _, tier := range response.AllowedTiers {
			if tier.IsDefault && strings.TrimSpace(tier.ID) != "" {
				return strings.TrimSpace(tier.ID)
			}
		}
		if tierID := strings.TrimSpace(response.CurrentTier.ID); tierID != "" {
			return tierID
		}
	}
	return "free-tier"
}
