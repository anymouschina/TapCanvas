package ali

import (
	"strings"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/dto"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
)

// 1x1 透明 PNG 的 data URL，避免单测发起真实网络下载。
const tinyPngDataURL = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M8AAAMBAQDJ/0KIAAAAAElFTkSuQmCC"

// Tests that a reference image sent via the OpenAI-compatible "image_urls" field
// survives the conversion into the DashScope multimodal-generation body for
// qwen image edit/generation models. Regression for the bug where image_urls
// landed in Extra and was silently dropped, so qwen-image-edit received text only.
// 用 data URL 验证既覆盖 image_urls 抽取，又覆盖 data: 直透（不触发网络）。
func TestOaiImage2AliImageRequest_ForwardsImageUrls(t *testing.T) {
	body := `{"model":"qwen-image-2.0-pro","prompt":"添加内容 到 第1张参考图","size":"1792x1024","n":1,"image_urls":["` + tinyPngDataURL + `"]}`

	var request dto.ImageRequest
	if err := common.Unmarshal([]byte(body), &request); err != nil {
		t.Fatalf("unmarshal request: %v", err)
	}

	info := &relaycommon.RelayInfo{}
	aliReq, err := oaiImage2AliImageRequest(info, request, true)
	if err != nil {
		t.Fatalf("convert: %v", err)
	}

	input, ok := aliReq.Input.(AliImageInput)
	if !ok {
		t.Fatalf("unexpected input type %T", aliReq.Input)
	}
	if len(input.Messages) != 1 {
		t.Fatalf("expected 1 message, got %d", len(input.Messages))
	}
	content, ok := input.Messages[0].Content.([]AliMediaContent)
	if !ok {
		t.Fatalf("unexpected content type %T", input.Messages[0].Content)
	}

	var gotImage, gotText string
	for _, item := range content {
		if item.Image != "" {
			gotImage = item.Image
		}
		if item.Text != "" {
			gotText = item.Text
		}
	}

	if gotImage != tinyPngDataURL {
		t.Errorf("reference image not forwarded upstream, content=%+v", content)
	}
	if gotText != "添加内容 到 第1张参考图" {
		t.Errorf("prompt not forwarded, got %q", gotText)
	}

	// 尺寸应被转换成 DashScope 的 width*height 形态。
	if aliReq.Parameters.Size != "1792*1024" {
		t.Errorf("size = %q, want 1792*1024", aliReq.Parameters.Size)
	}
}

// aliInlineImageRef 应：data: 原样透传、空串返回空、http(s) 下载失败时回退原 URL。
func TestAliInlineImageRef(t *testing.T) {
	if got := aliInlineImageRef("  " + tinyPngDataURL + "  "); got != tinyPngDataURL {
		t.Errorf("data url should pass through, got %q", got)
	}
	if got := aliInlineImageRef("   "); got != "" {
		t.Errorf("blank should return empty, got %q", got)
	}
	// 不可达主机：下载必失败，应回退原 URL，绝不丢图。
	const badURL = "https://127.0.0.1:9/nonexistent.png"
	if got := aliInlineImageRef(badURL); got != badURL {
		t.Errorf("failed download should fall back to original url, got %q", got)
	}
	if got := aliInlineImageRef("oss://bucket/key"); !strings.HasPrefix(got, "oss://") {
		t.Errorf("non-http ref should pass through, got %q", got)
	}
}
