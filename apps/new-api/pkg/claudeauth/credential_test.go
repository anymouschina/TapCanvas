package claudeauth

import "testing"

func TestNormalizeCredentialsAcceptsSub2APIExport(t *testing.T) {
	raw := `{
		"exported_at":"2026-07-26T05:25:51Z",
		"accounts":[{
			"platform":"anthropic",
			"type":"oauth",
			"credentials":{
				"access_token":"access-a",
				"refresh_token":"refresh-a",
				"expires_at":1785047151,
				"email_address":"claude@example.com",
				"account_uuid":"account-a"
			}
		}]
	}`

	keys, err := NormalizeCredentials(raw)
	if err != nil {
		t.Fatalf("NormalizeCredentials() error = %v", err)
	}
	if len(keys) != 1 {
		t.Fatalf("len(keys) = %d, want 1", len(keys))
	}
	if keys[0].AccountID != "account-a" || keys[0].Email != "claude@example.com" {
		t.Fatalf("normalized identity = %#v", keys[0])
	}
	if keys[0].Expired == "" || keys[0].LastRefresh != "2026-07-26T05:25:51Z" {
		t.Fatalf("normalized timestamps = %#v", keys[0])
	}
}

func TestNormalizeCredentialsRejectsNonAnthropicSub2APIAccount(t *testing.T) {
	_, err := NormalizeCredentials(`{"accounts":[{"platform":"openai","type":"oauth","credentials":{}}]}`)
	if err == nil {
		t.Fatal("NormalizeCredentials() error = nil, want platform error")
	}
}
