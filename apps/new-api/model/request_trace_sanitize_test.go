package model

import (
	"fmt"
	"strings"
	"testing"

	"github.com/QuantumNous/new-api/common"
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

// 场景复刻：/v1/videos 请求 body 是合法 JSON，prompt 很长但单字段没超限，
// 加上多张参考图/音频 URL 后整体超过 8192 字节。此前会走"整体纯文本截断"，
// 把后面的 URL 拦腰截断且产物不再是合法 JSON，导致日志媒体预览只剩第一张图。
func TestSanitizeLargeTextForLogKeepsShortURLFieldsWhenJSONBodyOverLimit(t *testing.T) {
	var urls []string
	var contentItems []string
	for i := 0; i < 4; i++ {
		u := fmt.Sprintf("https://file.example.com/gen/images/dir%d/%s.png", i, strings.Repeat(fmt.Sprintf("%d", i), 40))
		urls = append(urls, u)
		contentItems = append(contentItems, fmt.Sprintf(`{"type":"image_url","image_url":{"url":"%s"},"role":"reference_image"}`, u))
	}
	// ~7600 字节的中文 prompt：单字段低于 8192 不会被逐字段截断，但推高整体超限
	prompt := strings.Repeat("正午热浪街角 ", 400)
	raw := fmt.Sprintf(`{"model":"doubao-seedance-2-0-260128","prompt":"%s","metadata":{"content":[%s]}}`,
		prompt, strings.Join(contentItems, ","))
	if len(raw) <= 8192 {
		t.Fatalf("test fixture too small to trigger over-limit path: %d bytes", len(raw))
	}

	sanitized := SanitizeLargeTextForLog(raw)

	var decoded any
	if err := common.Unmarshal([]byte(sanitized), &decoded); err != nil {
		t.Fatalf("sanitized log is no longer valid JSON: %v\n%s", err, sanitized)
	}
	for i, u := range urls {
		if !strings.Contains(sanitized, u) {
			t.Fatalf("sanitized log lost short URL #%d (%s):\n%s", i+1, u, sanitized)
		}
	}
	// 单字段都在 8192 上限内：合法 JSON 应原样保留（体量控制由逐字段上限负责），
	// 绝不能落入整体纯文本截断把 JSON 切碎
	if sanitized != raw {
		t.Fatalf("valid JSON body with no oversized field should be kept as-is, got:\n%s", sanitized)
	}
}

// 合法 JSON 且存在超限字段时：逐字段截断生效，短字段完整保留，产物仍是合法 JSON
func TestSanitizeLargeTextForLogTruncatesOversizedFieldButKeepsShortFields(t *testing.T) {
	url := "https://file.example.com/gen/images/keep/" + strings.Repeat("a", 40) + ".png"
	prompt := strings.Repeat("正午热浪街角 ", 600) // 单字段 >8192 字节
	raw := fmt.Sprintf(`{"model":"m","prompt":"%s","metadata":{"content":[{"type":"image_url","image_url":{"url":"%s"}}]}}`, prompt, url)

	sanitized := SanitizeLargeTextForLog(raw)

	var decoded any
	if err := common.Unmarshal([]byte(sanitized), &decoded); err != nil {
		t.Fatalf("sanitized log is no longer valid JSON: %v\n%s", err, sanitized)
	}
	if !strings.Contains(sanitized, url) {
		t.Fatalf("sanitized log lost short URL field:\n%s", sanitized)
	}
	if !strings.Contains(sanitized, "[truncated ") {
		t.Fatalf("oversized prompt field was not truncated: %d bytes", len(sanitized))
	}
	if len(sanitized) >= len(raw) {
		t.Fatalf("sanitized log was not shortened: %d >= %d", len(sanitized), len(raw))
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
