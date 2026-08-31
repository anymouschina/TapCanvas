package codex

import "testing"

func TestNormalizeCodexOAuthCredentialsAcceptsSub2APIExport(t *testing.T) {
	raw := `{
		"accounts":[{
			"platform":"openai",
			"type":"oauth",
			"expires_at":1785047151,
			"credentials":{
				"access_token":"access-a",
				"refresh_token":"refresh-a",
				"chatgpt_account_id":"account-a"
			}
		}]
	}`

	keys, diagnostics, err := NormalizeCodexOAuthCredentials(raw)
	if err != nil {
		t.Fatalf("NormalizeCodexOAuthCredentials() error = %v", err)
	}
	if len(keys) != 1 || len(diagnostics) != 1 {
		t.Fatalf("keys=%d diagnostics=%d, want 1/1", len(keys), len(diagnostics))
	}
	if keys[0].AccountID != "account-a" || keys[0].AccessToken != "access-a" {
		t.Fatalf("normalized credential = %#v", keys[0])
	}
	if keys[0].Expired == "" {
		t.Fatal("normalized credential missing outer expires_at")
	}
}

func TestNormalizeCodexOAuthCredentialsRejectsNonOpenAISub2APIAccount(t *testing.T) {
	_, _, err := NormalizeCodexOAuthCredentials(`{"accounts":[{"platform":"anthropic","type":"oauth","credentials":{}}]}`)
	if err == nil {
		t.Fatal("NormalizeCodexOAuthCredentials() error = nil, want platform error")
	}
}
