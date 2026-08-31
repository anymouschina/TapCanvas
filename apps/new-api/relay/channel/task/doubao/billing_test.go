package doubao

import (
	"math"
	"net/http/httptest"
	"testing"

	relaycommon "github.com/QuantumNous/new-api/relay/common"
	"github.com/QuantumNous/new-api/types"
	"github.com/gin-gonic/gin"
)

func newBillingTestContext(t *testing.T, req relaycommon.TaskSubmitReq) *gin.Context {
	t.Helper()
	gin.SetMode(gin.TestMode)
	c, _ := gin.CreateTestContext(httptest.NewRecorder())
	relaycommon.SetTaskRequest(c, req)
	return c
}

func TestEstimateBillingUsesSpecPrice(t *testing.T) {
	a := &TaskAdaptor{}
	c := newBillingTestContext(t, relaycommon.TaskSubmitReq{
		Model:      "doubao-seedance-2-0-260128",
		Prompt:     "test",
		Resolution: "720p",
		Duration:   15,
	})
	info := &relaycommon.RelayInfo{OriginModelName: "doubao-seedance-2-0-260128"}
	info.PriceData = types.PriceData{ModelPrice: 10, UsePrice: true}

	ratios := a.EstimateBilling(c, info)
	got, ok := ratios["spec_price"]
	if !ok {
		t.Fatalf("expected spec_price ratio, got %v", ratios)
	}
	want := 1.71 * 15 / 10 // 720p ¥1.71/s × 15s ÷ 基础价 ¥10
	if math.Abs(got-want) > 1e-9 {
		t.Fatalf("spec_price = %v, want %v", got, want)
	}
}

func TestEstimateBillingAddsReferenceVideoDuration(t *testing.T) {
	a := &TaskAdaptor{}
	c := newBillingTestContext(t, relaycommon.TaskSubmitReq{
		Model: "doubao-seedance-2-0-260128", Resolution: "720p", Duration: 10,
		Metadata: map[string]interface{}{
			"billing_reference_video_duration_seconds": float64(6),
		},
	})
	info := &relaycommon.RelayInfo{OriginModelName: "doubao-seedance-2-0-260128"}
	info.PriceData = types.PriceData{ModelPrice: 10, UsePrice: true}

	got := a.EstimateBilling(c, info)["spec_price"]
	want := 1.71 * 16 / 10
	if math.Abs(got-want) > 1e-9 {
		t.Fatalf("spec_price = %v, want %v", got, want)
	}
}

func TestEstimateBillingUsesSeedance25SpecPrice(t *testing.T) {
	a := &TaskAdaptor{}
	c := newBillingTestContext(t, relaycommon.TaskSubmitReq{
		Model:      "doubao-seedance-2-5-260628",
		Prompt:     "test",
		Resolution: "720p",
		Duration:   30,
	})
	info := &relaycommon.RelayInfo{OriginModelName: "doubao-seedance-2-5-260628"}
	info.PriceData = types.PriceData{ModelPrice: 1.875 * 4, UsePrice: true}

	ratios := a.EstimateBilling(c, info)
	got, ok := ratios["spec_price"]
	if !ok {
		t.Fatalf("expected seedance 2.5 spec_price ratio, got %v", ratios)
	}
	want := 2.25 * 30 / (1.875 * 4)
	if math.Abs(got-want) > 1e-9 {
		t.Fatalf("seedance 2.5 spec_price = %v, want %v", got, want)
	}
}

func TestEstimateBillingSpecPriceFromMetadata(t *testing.T) {
	a := &TaskAdaptor{}
	c := newBillingTestContext(t, relaycommon.TaskSubmitReq{
		Model:  "doubao-seedance-2-0-fast-260128",
		Prompt: "test",
		Metadata: map[string]interface{}{
			"resolution": "480p",
			"duration":   float64(10),
		},
	})
	info := &relaycommon.RelayInfo{OriginModelName: "doubao-seedance-2-0-fast-260128"}
	info.PriceData = types.PriceData{ModelPrice: 8, UsePrice: true}

	ratios := a.EstimateBilling(c, info)
	got, ok := ratios["spec_price"]
	if !ok {
		t.Fatalf("expected spec_price ratio, got %v", ratios)
	}
	want := 0.6395 * 10 / 8
	if math.Abs(got-want) > 1e-9 {
		t.Fatalf("spec_price = %v, want %v", got, want)
	}
}

func TestEstimateBillingDefaultsTo720p5s(t *testing.T) {
	a := &TaskAdaptor{}
	c := newBillingTestContext(t, relaycommon.TaskSubmitReq{
		Model:  "doubao-seedance-2-0-260128",
		Prompt: "test",
	})
	info := &relaycommon.RelayInfo{OriginModelName: "doubao-seedance-2-0-260128"}
	info.PriceData = types.PriceData{ModelPrice: 10, UsePrice: true}

	ratios := a.EstimateBilling(c, info)
	got, ok := ratios["spec_price"]
	if !ok {
		t.Fatalf("expected spec_price ratio, got %v", ratios)
	}
	want := 1.71 * 5 / 10
	if math.Abs(got-want) > 1e-9 {
		t.Fatalf("spec_price = %v, want %v", got, want)
	}
}

func TestEstimateBillingFallsBackToVideoInputRatio(t *testing.T) {
	a := &TaskAdaptor{}
	// seed3d 没有视频规格价表；带视频输入时走旧的折扣回退。
	c := newBillingTestContext(t, relaycommon.TaskSubmitReq{
		Model:  "doubao-seed3d-2-0-260328",
		Prompt: "test",
		Metadata: map[string]interface{}{
			"content": []interface{}{
				map[string]interface{}{
					"type":      "video_url",
					"video_url": map[string]interface{}{"url": "https://example.com/v.mp4"},
				},
			},
		},
	})
	info := &relaycommon.RelayInfo{OriginModelName: "doubao-seed3d-2-0-260328"}
	info.PriceData = types.PriceData{ModelPrice: 5, UsePrice: true}

	ratios := a.EstimateBilling(c, info)
	if _, ok := ratios["spec_price"]; ok {
		t.Fatalf("seed3d should not get spec_price, got %v", ratios)
	}
	// seed3d 也不在 videoInputRatioMap，最终应为空
	if len(ratios) != 0 {
		t.Fatalf("expected empty ratios, got %v", ratios)
	}
}
