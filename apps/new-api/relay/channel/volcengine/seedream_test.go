package volcengine

import (
	"encoding/json"
	"net/http/httptest"
	"testing"

	"github.com/QuantumNous/new-api/dto"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	"github.com/QuantumNous/new-api/relay/constant"

	"github.com/gin-gonic/gin"
)

func imageRequestWithRefs(t *testing.T, model string, extra map[string]any) dto.ImageRequest {
	t.Helper()
	req := dto.ImageRequest{
		Model:  model,
		Prompt: "test",
		Size:   "1K",
		Extra:  map[string]json.RawMessage{},
	}
	for k, v := range extra {
		raw, err := json.Marshal(v)
		if err != nil {
			t.Fatalf("marshal extra %s: %v", k, err)
		}
		req.Extra[k] = raw
	}
	return req
}

func convertSeedreamImage(t *testing.T, model string, req dto.ImageRequest) dto.ImageRequest {
	t.Helper()
	gin.SetMode(gin.TestMode)
	c, _ := gin.CreateTestContext(httptest.NewRecorder())
	info := &relaycommon.RelayInfo{
		RelayMode:       constant.RelayModeImagesGenerations,
		OriginModelName: model,
		ChannelMeta:     &relaycommon.ChannelMeta{UpstreamModelName: model},
	}

	a := &Adaptor{}
	out, err := a.ConvertImageRequest(c, info, req)
	if err != nil {
		t.Fatalf("ConvertImageRequest error: %v", err)
	}
	converted, ok := out.(dto.ImageRequest)
	if !ok {
		t.Fatalf("unexpected converted type %T", out)
	}
	return converted
}

func TestSeedream5ProDropsSequentialParams(t *testing.T) {
	const model = "doubao-seedream-5-0-pro-260628"
	req := imageRequestWithRefs(t, model, map[string]any{
		"image_urls": []string{"https://example.com/a.png", "https://example.com/b.png"},
		// 客户端透传的组图参数也必须被剥离
		"sequential_image_generation":         "auto",
		"sequential_image_generation_options": map[string]int{"max_images": 4},
	})

	converted := convertSeedreamImage(t, model, req)

	if _, has := converted.Extra["sequential_image_generation"]; has {
		t.Errorf("sequential_image_generation must be stripped for 5.0 Pro")
	}
	if _, has := converted.Extra["sequential_image_generation_options"]; has {
		t.Errorf("sequential_image_generation_options must be stripped for 5.0 Pro")
	}
	if len(converted.Image) == 0 {
		t.Errorf("reference images should still be remapped to the image field")
	}
	if converted.Size != "1k" {
		t.Errorf("size = %q, want 1k passthrough (5.0 Pro supports 1K/2K)", converted.Size)
	}
}

func TestSeedream50InjectsSequentialParams(t *testing.T) {
	const model = "doubao-seedream-5-0-260128"
	req := imageRequestWithRefs(t, model, map[string]any{
		"image_urls": []string{"https://example.com/a.png"},
	})

	converted := convertSeedreamImage(t, model, req)

	if _, has := converted.Extra["sequential_image_generation"]; !has {
		t.Errorf("sequential_image_generation should be injected for non-Pro seedream")
	}
	if _, has := converted.Extra["sequential_image_generation_options"]; !has {
		t.Errorf("sequential_image_generation_options should be injected for non-Pro seedream")
	}
}

func TestIsSeedream5ProModel(t *testing.T) {
	cases := map[string]bool{
		"doubao-seedream-5-0-pro-260628": true,
		"seedream-5.0-pro":               true,
		"doubao-seedream-5-0-260128":     false,
		"doubao-seedream-4-0-250828":     false,
	}
	for model, want := range cases {
		if got := isSeedream5ProModel(model); got != want {
			t.Errorf("isSeedream5ProModel(%q) = %v, want %v", model, got, want)
		}
	}
}

func TestResolveSeedreamSizeNamedTiers(t *testing.T) {
	for _, size := range []string{"1K", "1k", "2K", "3k", "4K"} {
		got := resolveSeedreamSize(size, nil)
		if _, ok := seedreamNamedSizes[got]; !ok {
			t.Errorf("resolveSeedreamSize(%q) = %q, expected named tier passthrough", size, got)
		}
	}
}
