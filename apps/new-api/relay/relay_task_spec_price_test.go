package relay

import (
	"math"
	"net/http/httptest"
	"testing"

	"github.com/QuantumNous/new-api/dto"
	"github.com/QuantumNous/new-api/relay/channel/task/taskcommon"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	"github.com/QuantumNous/new-api/types"
	"github.com/gin-gonic/gin"
)

func TestResolveTaskVideoSpec(t *testing.T) {
	req := relaycommon.TaskSubmitReq{Resolution: "720p", Duration: 15}
	res, dur := taskcommon.ResolveTaskVideoSpec(&req)
	if res != "720p" || dur != 15 {
		t.Fatalf("got (%q, %d)", res, dur)
	}

	// metadata 优先于顶层字段
	req = relaycommon.TaskSubmitReq{
		Resolution: "480p",
		Duration:   5,
		Metadata: map[string]interface{}{
			"resolution": "1080p",
			"duration":   "12",
		},
	}
	res, dur = taskcommon.ResolveTaskVideoSpec(&req)
	if res != "1080p" || dur != 12 {
		t.Fatalf("metadata override got (%q, %d)", res, dur)
	}

	// seconds 字符串兜底
	req = relaycommon.TaskSubmitReq{Resolution: "720p", Seconds: "8"}
	res, dur = taskcommon.ResolveTaskVideoSpec(&req)
	if res != "720p" || dur != 8 {
		t.Fatalf("seconds fallback got (%q, %d)", res, dur)
	}
}

func TestEstimateTaskVideoSpecPriceRatio(t *testing.T) {
	gin.SetMode(gin.TestMode)
	c, _ := gin.CreateTestContext(httptest.NewRecorder())
	relaycommon.SetTaskRequest(c, relaycommon.TaskSubmitReq{
		Model:      "doubao-seedance-2-0-260128",
		Resolution: "720p",
		Duration:   24,
	})
	info := &relaycommon.RelayInfo{OriginModelName: "doubao-seedance-2-0-260128"}
	info.PriceData = types.PriceData{ModelPrice: 10, UsePrice: true}

	ratio, ok := estimateTaskVideoSpecPriceRatio(c, info)
	if !ok {
		t.Fatal("expected ratio")
	}
	want := 1.71 * 24 / 10
	if math.Abs(ratio-want) > 1e-9 {
		t.Fatalf("ratio = %v, want %v", ratio, want)
	}

	// 未携带规格 → 不按规格计价
	c2, _ := gin.CreateTestContext(httptest.NewRecorder())
	relaycommon.SetTaskRequest(c2, relaycommon.TaskSubmitReq{Model: "doubao-seedance-2-0-260128"})
	if _, ok := estimateTaskVideoSpecPriceRatio(c2, info); ok {
		t.Fatal("expected no ratio without explicit spec")
	}
}

func TestEstimateTaskVideoSpecPriceRatioUsesPricingModelReference(t *testing.T) {
	gin.SetMode(gin.TestMode)
	c, _ := gin.CreateTestContext(httptest.NewRecorder())
	relaycommon.SetTaskRequest(c, relaycommon.TaskSubmitReq{
		Model:      "kling-o3-funai",
		Resolution: "720p",
		Duration:   5,
	})
	info := &relaycommon.RelayInfo{
		OriginModelName:  "kling-o3-funai",
		PricingModelName: "kling-o3",
		PriceData: types.PriceData{
			ModelPrice: 0.18,
			UsePrice:   true,
		},
	}

	ratio, ok := estimateTaskVideoSpecPriceRatio(c, info)
	if !ok {
		t.Fatal("expected price-source spec ratio")
	}
	want := 0.06 * 5 / 0.18
	if math.Abs(ratio-want) > 1e-9 {
		t.Fatalf("ratio = %v, want %v", ratio, want)
	}
}

func TestEffectiveTaskChannelPriceRatioUsesCostFloor(t *testing.T) {
	gin.SetMode(gin.TestMode)
	c, _ := gin.CreateTestContext(httptest.NewRecorder())
	relaycommon.SetTaskRequest(c, relaycommon.TaskSubmitReq{Duration: 4, Resolution: "720p"})
	info := &relaycommon.RelayInfo{
		ChannelMeta: &relaycommon.ChannelMeta{ChannelSetting: dto.ChannelSettings{
			PriceRatio:                0.5,
			MinVideoPriceCNYPerSecond: 0.3,
		}},
		PriceData: types.PriceData{
			ModelPrice: 0.96,
			OtherRatios: map[string]float64{
				"spec_price": 1,
			},
		},
	}

	ratio, err := effectiveTaskChannelPriceRatio(c, info)
	if err != nil {
		t.Fatalf("effectiveTaskChannelPriceRatio: %v", err)
	}
	if math.Abs(ratio-1.25) > 1e-9 {
		t.Fatalf("ratio = %v, want 1.25", ratio)
	}
}
