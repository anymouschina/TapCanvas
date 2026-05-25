package model

import (
	"strings"
	"testing"
)

func TestSanitizeLargeTextForLogStripsDataURLBase64InJSON(t *testing.T) {
	base64Payload := strings.Repeat("A", 1200)
	raw := `{"model":"gpt-image-2","images":["data:image/png;base64,` + base64Payload + `"],"prompt":"keep"}`

	sanitized := SanitizeLargeTextForLog(raw)

	if strings.Contains(sanitized, base64Payload) {
		t.Fatalf("sanitized log still contains raw base64 payload: %s", sanitized)
	}
	if !strings.Contains(sanitized, "data:image/png;base64,[base64 ~1200 chars]") {
		t.Fatalf("sanitized log did not preserve base64 size marker: %s", sanitized)
	}
	if !strings.Contains(sanitized, `"prompt":"keep"`) {
		t.Fatalf("sanitized log lost non-base64 fields: %s", sanitized)
	}
}

func TestSanitizeLargeTextForLogStripsNestedJSONString(t *testing.T) {
	base64Payload := strings.Repeat("B", 1200)
	raw := `{"upstreamRequest":"{\"images\":[\"data:image/jpeg;base64,` + base64Payload + `\"],\"size\":\"3840x2160\"}"}`

	sanitized := SanitizeLargeTextForLog(raw)

	if strings.Contains(sanitized, base64Payload) {
		t.Fatalf("sanitized log still contains nested raw base64 payload: %s", sanitized)
	}
	if !strings.Contains(sanitized, "data:image/jpeg;base64,[base64 ~1200 chars]") {
		t.Fatalf("sanitized log did not preserve nested base64 size marker: %s", sanitized)
	}
	if !strings.Contains(sanitized, `\"size\":\"3840x2160\"`) {
		t.Fatalf("sanitized log lost nested request fields: %s", sanitized)
	}
}

func TestSanitizeLargeTextForLogTruncatesPlainLongText(t *testing.T) {
	raw := strings.Repeat("plain text with spaces. ", 500)

	sanitized := SanitizeLargeTextForLog(raw)

	if len(sanitized) >= len(raw) {
		t.Fatalf("sanitized log was not shortened")
	}
	if !strings.Contains(sanitized, "[truncated ") {
		t.Fatalf("sanitized log did not include truncation marker: %s", sanitized)
	}
}
