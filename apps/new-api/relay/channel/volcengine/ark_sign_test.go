package volcengine

import (
	"strings"
	"testing"
	"time"
)

func TestSignArkRequest(t *testing.T) {
	out := signArkRequest(arkSignInput{
		accessKey: "AK", secretKey: "SK", region: "cn-beijing",
		service: "ark", host: "open.volcengineapi.com", method: "POST",
		action: "CreateAsset", version: "2024-01-01", body: `{"a":1}`,
		date: time.Date(2026, 5, 31, 7, 37, 8, 0, time.UTC),
	})
	if out.url != "https://open.volcengineapi.com/?Action=CreateAsset&Version=2024-01-01" {
		t.Fatalf("url: %s", out.url)
	}
	if out.headers["X-Date"] != "20260531T073708Z" {
		t.Fatalf("x-date: %s", out.headers["X-Date"])
	}
	auth := out.headers["Authorization"]
	if !strings.Contains(auth, "Credential=AK/20260531/cn-beijing/ark/request") {
		t.Fatalf("auth scope missing: %s", auth)
	}
	if !strings.Contains(auth, "SignedHeaders=content-type;host;x-content-sha256;x-date") {
		t.Fatalf("auth signed headers missing: %s", auth)
	}
	idx := strings.Index(auth, "Signature=")
	if idx < 0 {
		t.Fatalf("no signature: %s", auth)
	}
	sig := auth[idx+len("Signature="):]
	if len(sig) != 64 {
		t.Fatalf("signature must be 64 hex chars, got %d: %s", len(sig), sig)
	}
	out2 := signArkRequest(arkSignInput{
		accessKey: "AK", secretKey: "SK", region: "cn-beijing",
		service: "ark", host: "open.volcengineapi.com", method: "POST",
		action: "CreateAsset", version: "2024-01-01", body: `{"a":1}`,
		date: time.Date(2026, 5, 31, 7, 37, 8, 0, time.UTC),
	})
	if out.headers["Authorization"] != out2.headers["Authorization"] {
		t.Fatal("signature not deterministic")
	}
}
