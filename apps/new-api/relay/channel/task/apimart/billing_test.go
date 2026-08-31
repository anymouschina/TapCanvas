package apimart

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

func estimateSpecPrice(t *testing.T, modelName string, modelPrice float64, req relaycommon.TaskSubmitReq) (float64, bool) {
	t.Helper()
	a := &TaskAdaptor{}
	c := newBillingTestContext(t, req)
	info := &relaycommon.RelayInfo{OriginModelName: modelName}
	info.PriceData = types.PriceData{ModelPrice: modelPrice, UsePrice: true}
	ratios := a.EstimateBilling(c, info)
	v, ok := ratios["spec_price"]
	return v, ok
}

func TestEstimateBillingSeedanceAliasLinear(t *testing.T) {
	// doubao-seedance-2.0-face 720p ¥2.3389/s
	got, ok := estimateSpecPrice(t, "doubao-seedance-2.0-face", 22, relaycommon.TaskSubmitReq{
		Model: "doubao-seedance-2.0-face", Resolution: "720p", Duration: 10,
	})
	if !ok {
		t.Fatal("expected spec_price")
	}
	want := 2.3389 * 10 / 22
	if math.Abs(got-want) > 1e-9 {
		t.Fatalf("spec_price = %v, want %v", got, want)
	}
}

func TestEstimateBillingPixverseDefaultsToSound(t *testing.T) {
	// pixverse-v6 默认 audio=true → 720p+sound ¥0.730/s
	got, ok := estimateSpecPrice(t, "pixverse-v6", 2.19, relaycommon.TaskSubmitReq{
		Model: "pixverse-v6", Resolution: "720p", Duration: 5,
	})
	if !ok {
		t.Fatal("expected spec_price")
	}
	want := 0.730 * 5 / 2.19
	if math.Abs(got-want) > 1e-9 {
		t.Fatalf("spec_price = %v, want %v", got, want)
	}

	// metadata.audio=false 显式关闭 → 基础档 ¥0.584/s
	got, ok = estimateSpecPrice(t, "pixverse-v6", 2.19, relaycommon.TaskSubmitReq{
		Model: "pixverse-v6", Resolution: "720p", Duration: 5,
		Metadata: map[string]interface{}{"audio": false},
	})
	if !ok {
		t.Fatal("expected spec_price")
	}
	want = 0.584 * 5 / 2.19
	if math.Abs(got-want) > 1e-9 {
		t.Fatalf("no-sound spec_price = %v, want %v", got, want)
	}
}

func TestEstimateBillingKlingOmniVideoReferenceWins(t *testing.T) {
	// kling-v3-omni 带参考视频且 audio=true → +video 档优先（互斥、视频优先）¥1.6556/s
	got, ok := estimateSpecPrice(t, "kling-v3-omni", 3.07, relaycommon.TaskSubmitReq{
		Model: "kling-v3-omni", Resolution: "720p", Duration: 5,
		Metadata: map[string]interface{}{
			"audio":     true,
			"video_url": "https://example.com/ref.mp4",
		},
	})
	if !ok {
		t.Fatal("expected spec_price")
	}
	want := 1.6556 * 5 / 3.07
	if math.Abs(got-want) > 1e-9 {
		t.Fatalf("spec_price = %v, want %v", got, want)
	}
}

func TestEstimateBillingMergedKlingV3VideoReferenceUsesVideoTier(t *testing.T) {
	got, ok := estimateSpecPrice(t, "kling-v3", 1.40, relaycommon.TaskSubmitReq{
		Model: "kling-v3", Resolution: "720p", Duration: 5,
		Metadata: map[string]interface{}{"video_url": "https://example.com/ref.mp4"},
	})
	if !ok {
		t.Fatal("expected spec_price")
	}
	want := 1.6556 * 5 / 1.40
	if math.Abs(got-want) > 1e-9 {
		t.Fatalf("spec_price = %v, want %v", got, want)
	}
}

func TestEstimateBillingKlingV3SoundVariant(t *testing.T) {
	// kling-v3 audio=true → 1080p+sound ¥1.4717/s
	got, ok := estimateSpecPrice(t, "kling-v3", 1.40, relaycommon.TaskSubmitReq{
		Model: "kling-v3", Resolution: "1080p", Duration: 10,
		Metadata: map[string]interface{}{"audio": true},
	})
	if !ok {
		t.Fatal("expected spec_price")
	}
	want := 1.4717 * 10 / 1.40
	if math.Abs(got-want) > 1e-9 {
		t.Fatalf("spec_price = %v, want %v", got, want)
	}
}

func TestEstimateBillingVariantFallsBackToBase(t *testing.T) {
	// kling-v3-omni 4k 带参考视频：价表无 4k+video → 回退基础 4k ¥7.0391/s（与 hono 口径一致）
	got, ok := estimateSpecPrice(t, "kling-v3-omni", 3.07, relaycommon.TaskSubmitReq{
		Model: "kling-v3-omni", Resolution: "4k", Duration: 5,
		Metadata: map[string]interface{}{"video_url": "https://example.com/ref.mp4"},
	})
	if !ok {
		t.Fatal("expected spec_price")
	}
	want := 7.0391 * 5 / 3.07
	if math.Abs(got-want) > 1e-9 {
		t.Fatalf("spec_price = %v, want %v", got, want)
	}
}

func TestEstimateBillingNoSpecReturnsNil(t *testing.T) {
	// 未显式携带规格 → 保持按次基础价
	if _, ok := estimateSpecPrice(t, "doubao-seedance-2.0", 20, relaycommon.TaskSubmitReq{
		Model: "doubao-seedance-2.0",
	}); ok {
		t.Fatal("expected no spec_price without explicit spec")
	}
	// 价表没有的模型 → 保持按次基础价
	if _, ok := estimateSpecPrice(t, "viduq3", 8, relaycommon.TaskSubmitReq{
		Model: "viduq3", Resolution: "720p", Duration: 5,
	}); ok {
		t.Fatal("expected no spec_price for model without pricing rules")
	}
}
