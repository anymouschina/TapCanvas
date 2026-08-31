package runninghub

import "testing"

func TestExtractTaskID(t *testing.T) {
	body := []byte(`{"taskId":"abc123","status":"QUEUED","results":null}`)
	id, err := extractTaskID(body)
	if err != nil {
		t.Fatalf("unexpected err: %v", err)
	}
	if id != "abc123" {
		t.Fatalf("want abc123, got %q", id)
	}
}

func TestParseTaskResult_Success(t *testing.T) {
	body := []byte(`{"taskId":"t","status":"SUCCESS","results":[{"url":"https://cdn.runninghub.ai/out/a.png","outputType":"png"}]}`)
	status, urls := parseTaskResult(body)
	if status != taskStatusSuccess {
		t.Fatalf("want success, got %q", status)
	}
	if len(urls) != 1 || urls[0] != "https://cdn.runninghub.ai/out/a.png" {
		t.Fatalf("unexpected urls: %v", urls)
	}
}

func TestParseTaskResult_RunningNoUrls(t *testing.T) {
	body := []byte(`{"taskId":"t","status":"RUNNING","results":null}`)
	status, urls := parseTaskResult(body)
	if status != taskStatusRunning {
		t.Fatalf("want running, got %q", status)
	}
	if len(urls) != 0 {
		t.Fatalf("want no urls, got %v", urls)
	}
}

func TestParseTaskResult_Failed(t *testing.T) {
	body := []byte(`{"taskId":"t","status":"FAILED","errorMessage":"content blocked"}`)
	status, _ := parseTaskResult(body)
	if status != taskStatusFailed {
		t.Fatalf("want failed, got %q", status)
	}
	if msg := extractFailureReason(body); msg != "content blocked" {
		t.Fatalf("want 'content blocked', got %q", msg)
	}
}

func TestResolveEndpoint(t *testing.T) {
	cases := map[string]string{
		"gpt-image-2":                    "rhart-image-g-2",
		"gemini-3.1-flash-image-preview": "rhart-image-n-g31-flash",
		"gemini-3-pro-image-preview":     "rhart-image-n-pro",
	}
	for key, wantSlug := range cases {
		e, ok := resolveEndpoint(key)
		if !ok {
			t.Fatalf("%s: not resolved", key)
		}
		if e.slug != wantSlug {
			t.Fatalf("%s: want slug %q, got %q", key, wantSlug, e.slug)
		}
	}
	if _, ok := resolveEndpoint("nonexistent-model"); ok {
		t.Fatalf("expected unknown model to not resolve")
	}
}

func TestNormalizeResolution(t *testing.T) {
	cases := map[string]string{
		"":          "1k",
		"1k":        "1k",
		"2K":        "2k",
		"4k":        "4k",
		"1024":      "1k",
		"2048":      "2k",
		"1024x1024": "1k",
		"2048x2048": "2k",
		"weird":     "1k",
	}
	for in, want := range cases {
		if got := normalizeResolution(in); got != want {
			t.Fatalf("normalizeResolution(%q): want %q, got %q", in, want, got)
		}
	}
}
