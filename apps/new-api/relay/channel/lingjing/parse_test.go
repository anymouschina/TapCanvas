package lingjing

import "testing"

func TestExtractTaskID(t *testing.T) {
	cases := []struct {
		name string
		body string
		want string
	}{
		{"nested data.taskId", `{"code":0,"msg":"ok","data":{"taskId":"abc123"}}`, "abc123"},
		{"flat id", `{"id":"t-999","status":"PENDING"}`, "t-999"},
		{"numeric task_id", `{"data":{"task_id":1024}}`, "1024"},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			got, err := extractTaskID([]byte(c.body))
			if err != nil {
				t.Fatalf("unexpected err: %v", err)
			}
			if got != c.want {
				t.Fatalf("got %q want %q", got, c.want)
			}
		})
	}
	if _, err := extractTaskID([]byte(`{"code":9003,"msg":"bad"}`)); err == nil {
		t.Fatal("expected error when no task id present")
	}
}

func TestParseTaskResult(t *testing.T) {
	cases := []struct {
		name       string
		body       string
		wantStatus string
		wantURLs   int
	}{
		{
			name:       "running",
			body:       `{"code":0,"data":{"status":"RUNNING"}}`,
			wantStatus: taskStatusRunning,
			wantURLs:   0,
		},
		{
			name:       "success with nested image array",
			body:       `{"code":0,"data":{"status":"SUCCESS","results":[{"imageUrl":"https://cdn.x/a.png"},{"imageUrl":"https://cdn.x/b.jpg"}]}}`,
			wantStatus: taskStatusSuccess,
			wantURLs:   2,
		},
		{
			name:       "urls present but status unknown => success",
			body:       `{"data":{"output":["https://cdn.x/c.webp"]}}`,
			wantStatus: taskStatusSuccess,
			wantURLs:   1,
		},
		{
			name:       "failed",
			body:       `{"data":{"status":"FAILED","failReason":"nsfw"}}`,
			wantStatus: taskStatusFailed,
			wantURLs:   0,
		},
		{
			name:       "numeric status 2 = success",
			body:       `{"data":{"status":2,"url":"https://cdn.x/d.png"}}`,
			wantStatus: taskStatusSuccess,
			wantURLs:   1,
		},
		{
			name:       "non-image http under non-url key is ignored",
			body:       `{"data":{"status":"RUNNING","callback":"https://hook.x/cb"}}`,
			wantStatus: taskStatusRunning,
			wantURLs:   0,
		},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			status, urls := parseTaskResult([]byte(c.body))
			if status != c.wantStatus {
				t.Fatalf("status got %q want %q", status, c.wantStatus)
			}
			if len(urls) != c.wantURLs {
				t.Fatalf("urls got %d (%v) want %d", len(urls), urls, c.wantURLs)
			}
		})
	}
}

func TestResolveUpstreamModelCode(t *testing.T) {
	cases := map[string]string{
		"gpt-image-2":                    "gt_image_official_az",
		"gemini-3.1-flash-image-preview": "baba_2",
		"gemini-3-pro-image-preview":     "baba_pro",
		// unknown / raw code passes through unchanged
		"baba_2":     "baba_2",
		"some-other": "some-other",
	}
	for in, want := range cases {
		if got := resolveUpstreamModelCode(in); got != want {
			t.Fatalf("resolveUpstreamModelCode(%q) = %q, want %q", in, got, want)
		}
	}
}

func TestSplitKey(t *testing.T) {
	ak, sk := splitKey("ak_xxx|sk_yyy")
	if ak != "ak_xxx" || sk != "sk_yyy" {
		t.Fatalf("got ak=%q sk=%q", ak, sk)
	}
	ak, sk = splitKey("only_access")
	if ak != "only_access" || sk != "" {
		t.Fatalf("got ak=%q sk=%q", ak, sk)
	}
}
