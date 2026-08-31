package tencent

import (
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/dto"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	"github.com/gin-gonic/gin"
)

func TestResolveTencentImageVersionUsesQualityOnly(t *testing.T) {
	t.Parallel()

	tests := []struct {
		quality    string
		resolution string
		want       string
	}{
		{quality: "auto", resolution: "1K", want: "image2_low"},
		{quality: "auto", resolution: "2K", want: "image2_low"},
		{quality: "auto", resolution: "4K", want: "image2_low"},
		{quality: "low", resolution: "4K", want: "image2_low"},
		{quality: "medium", resolution: "1K", want: "image2_medium"},
		{quality: "medium", resolution: "4K", want: "image2_medium"},
		{quality: "high", resolution: "1K", want: "image2_high"},
		{quality: "high", resolution: "4K", want: "image2_high"},
	}

	for _, test := range tests {
		test := test
		t.Run(test.quality+"_"+test.resolution, func(t *testing.T) {
			t.Parallel()
			if got := resolveTencentImageVersion(test.quality, test.resolution); got != test.want {
				t.Fatalf("resolveTencentImageVersion(%q, %q) = %q, want %q", test.quality, test.resolution, got, test.want)
			}
		})
	}
}

func TestConvertImageRequestReadsTypedQualityAndKeepsResolutionIndependent(t *testing.T) {
	t.Parallel()

	var request dto.ImageRequest
	if err := common.Unmarshal([]byte(`{
		"model":"gpt-image-2",
		"prompt":"an apple",
		"n":1,
		"size":"16:9",
		"resolution":"4K",
		"quality":"auto"
	}`), &request); err != nil {
		t.Fatal(err)
	}
	if request.Quality != "auto" {
		t.Fatalf("request.Quality = %q, want auto", request.Quality)
	}
	if _, exists := request.Extra["quality"]; exists {
		t.Fatal("quality must be parsed as a typed ImageRequest field")
	}

	c, _ := gin.CreateTestContext(nil)
	common.SetContextKey(c, constant.ContextKeyChannelKey, "1412292672|secret-id|secret-key")
	info := &relaycommon.RelayInfo{ChannelMeta: &relaycommon.ChannelMeta{UpstreamModelName: "gpt-image-2"}}
	converted, err := (&Adaptor{}).ConvertImageRequest(c, info, request)
	if err != nil {
		t.Fatal(err)
	}
	payload, ok := converted.(*vodCreateImageTaskReq)
	if !ok {
		t.Fatalf("converted type = %T, want *vodCreateImageTaskReq", converted)
	}
	if payload.ModelName != "OG" || payload.ModelVersion != "image2_low" {
		t.Fatalf("model = %s/%s, want OG/image2_low", payload.ModelName, payload.ModelVersion)
	}
	if payload.OutputConfig.Resolution != "4K" || payload.OutputConfig.AspectRatio != "16:9" {
		t.Fatalf("output config = %#v", payload.OutputConfig)
	}
}

func TestConvertImageRequestRejectsMultipleImages(t *testing.T) {
	t.Parallel()

	n := uint(2)
	_, err := (&Adaptor{}).ConvertImageRequest(nil, nil, dto.ImageRequest{N: &n})
	if err == nil || err.Error() != "tencent image: n=2 is unsupported; this channel returns exactly one image per request" {
		t.Fatalf("error = %v", err)
	}
}
