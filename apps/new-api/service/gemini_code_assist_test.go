package service

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

func TestFetchGeminiAntigravityProjectIDLoadsExistingProject(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		if request.URL.Path != "/v1internal:loadCodeAssist" {
			http.NotFound(response, request)
			return
		}
		if request.Header.Get("Authorization") != "Bearer access-token" {
			t.Fatalf("Authorization = %q", request.Header.Get("Authorization"))
		}
		if request.Header.Get("X-Goog-Api-Client") != "" {
			t.Fatalf("X-Goog-Api-Client = %q, want empty", request.Header.Get("X-Goog-Api-Client"))
		}
		response.Header().Set("Content-Type", "application/json")
		_, _ = response.Write([]byte(`{"cloudaicompanionProject":{"id":"project-1"}}`))
	}))
	defer server.Close()

	t.Setenv("GEMINI_CODE_ASSIST_BASE_URL", server.URL)
	projectID, err := FetchGeminiAntigravityProjectID(context.Background(), "access-token", "")
	if err != nil {
		t.Fatalf("FetchGeminiAntigravityProjectID() error = %v", err)
	}
	if projectID != "project-1" {
		t.Fatalf("projectID = %q, want project-1", projectID)
	}
}

func TestParseGeminiAntigravityCreditUsagePreservesMissingBalance(t *testing.T) {
	now := time.Unix(1_700_000_000, 0)
	usage := parseGeminiAntigravityCreditUsage(&geminiCodeAssistLoadResponse{
		PaidTier: geminiCodeAssistPaidTier{
			ID: "tier-1",
			AvailableCredits: []geminiCodeAssistAvailableCredit{{
				CreditType:                  "GOOGLE_ONE_AI",
				MinimumCreditAmountForUsage: "50",
			}},
		},
	}, now)
	if usage.CreditKnown || usage.CreditAvailable {
		t.Fatalf("missing upstream creditAmount must remain unknown: %#v", usage)
	}
	if usage.PaidTierID != "tier-1" || usage.QuotaSource != antigravityCreditQuotaSource {
		t.Fatalf("tier metadata not preserved: %#v", usage)
	}
}

func TestParseGeminiAntigravityCreditUsageUsesActualBalance(t *testing.T) {
	usage := parseGeminiAntigravityCreditUsage(&geminiCodeAssistLoadResponse{
		PaidTier: geminiCodeAssistPaidTier{AvailableCredits: []geminiCodeAssistAvailableCredit{{
			CreditType:                  "GOOGLE_ONE_AI",
			CreditAmount:                "75",
			MinimumCreditAmountForUsage: "50",
		}}},
	}, time.Now())
	if !usage.CreditKnown || !usage.CreditAvailable || usage.CreditAmount != 75 || usage.MinimumCreditAmount != 50 {
		t.Fatalf("unexpected parsed credit usage: %#v", usage)
	}
}

func TestFetchGeminiAntigravityProjectIDOnboardsMissingProject(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		switch request.URL.Path {
		case "/v1internal:loadCodeAssist":
			response.Header().Set("Content-Type", "application/json")
			_, _ = response.Write([]byte(`{"allowedTiers":[{"id":"standard-tier","isDefault":true}]}`))
		case "/v1internal:onboardUser":
			if request.Header.Get("X-Goog-Api-Client") != geminiAntigravityGoogleAPIClient {
				t.Fatalf("X-Goog-Api-Client = %q", request.Header.Get("X-Goog-Api-Client"))
			}
			if request.Header.Get("User-Agent") != geminiAntigravityNodeUserAgent {
				t.Fatalf("User-Agent = %q", request.Header.Get("User-Agent"))
			}
			response.Header().Set("Content-Type", "application/json")
			_, _ = response.Write([]byte(`{"done":true,"response":{"cloudaicompanionProject":{"id":"project-onboarded"}}}`))
		default:
			http.NotFound(response, request)
		}
	}))
	defer server.Close()

	t.Setenv("GEMINI_CODE_ASSIST_BASE_URL", server.URL)
	t.Setenv("GEMINI_CODE_ASSIST_DAILY_BASE_URL", server.URL)
	projectID, err := FetchGeminiAntigravityProjectID(context.Background(), "access-token", "")
	if err != nil {
		t.Fatalf("FetchGeminiAntigravityProjectID() error = %v", err)
	}
	if projectID != "project-onboarded" {
		t.Fatalf("projectID = %q, want project-onboarded", projectID)
	}
}
