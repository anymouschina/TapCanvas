package relay

import (
	"encoding/json"
	"net/http/httptest"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/dto"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	"github.com/gin-gonic/gin"
)

func TestSelectChannelBoundImageTierModelUsesSameCanonicalChannelModel(t *testing.T) {
	t.Parallel()

	request := imageRequestWithExtra(t, map[string]string{"imageSize": "2K"})
	got, ok, err := selectChannelBoundImageTierModel(
		"gpt-image-2",
		imageResolutionTier(request),
		[]string{"gpt-image-2", "gpt-image-2-pro"},
		nil,
	)
	if err != nil {
		t.Fatalf("selectChannelBoundImageTierModel error: %v", err)
	}
	if !ok {
		t.Fatal("expected tier model selection")
	}
	if got != "gpt-image-2-pro" {
		t.Fatalf("selected model = %q", got)
	}
}

func TestSelectChannelBoundImageTierModelRejectsWhenNoChannelTierExists(t *testing.T) {
	t.Parallel()

	request := imageRequestWithExtra(t, map[string]string{"resolution": "4K"})
	if got, ok, err := selectChannelBoundImageTierModel("gpt-image-2", imageResolutionTier(request), []string{"gpt-image-2"}, nil); err == nil || ok {
		t.Fatalf("unexpected tier model %q", got)
	}
}

func TestSelectChannelBoundImageTierModelDoesNotUseUnconfiguredRequestedTier(t *testing.T) {
	t.Parallel()

	request := imageRequestWithExtra(t, map[string]string{"resolution": "4K"})
	if got, ok, err := selectChannelBoundImageTierModel("gpt-image-2-pro", imageResolutionTier(request), []string{"gpt-image-2"}, nil); err == nil || ok {
		t.Fatalf("unexpected tier model %q", got)
	}
}

func TestSelectChannelBoundImageTierModelKeepsBaseFor1K(t *testing.T) {
	t.Parallel()

	request := imageRequestWithExtra(t, map[string]string{"imageSize": "1K"})
	if got, ok, err := selectChannelBoundImageTierModel("gpt-image-2", imageResolutionTier(request), []string{"gpt-image-2", "gpt-image-2-vip"}, nil); err != nil || ok {
		t.Fatalf("unexpected tier model %q", got)
	}
}

func TestSelectChannelBoundImageTierModelPrefersProFor4K(t *testing.T) {
	t.Parallel()

	request := imageRequestWithExtra(t, map[string]string{"resolution": "4K"})
	got, ok, err := selectChannelBoundImageTierModel(
		"gpt-image-2",
		imageResolutionTier(request),
		[]string{"gpt-image-2", "gpt-image-2-vip", "gpt-image-2-pro"},
		nil,
	)
	if err != nil {
		t.Fatalf("selectChannelBoundImageTierModel error: %v", err)
	}
	if !ok {
		t.Fatal("expected tier model selection")
	}
	if got != "gpt-image-2-pro" {
		t.Fatalf("selected model = %q", got)
	}
}

func TestSelectChannelBoundImageTierModelUsesVipFor4K(t *testing.T) {
	t.Parallel()

	request := imageRequestWithExtra(t, map[string]string{"resolution": "4K"})
	got, ok, err := selectChannelBoundImageTierModel(
		"gpt-image-2",
		imageResolutionTier(request),
		[]string{"gpt-image-2", "gpt-image-2-vip"},
		nil,
	)
	if err != nil {
		t.Fatalf("selectChannelBoundImageTierModel error: %v", err)
	}
	if !ok {
		t.Fatal("expected tier model selection")
	}
	if got != "gpt-image-2-vip" {
		t.Fatalf("selected model = %q", got)
	}
}

func TestSelectChannelBoundImageTierModelDoesNotUseOfficialForBase4K(t *testing.T) {
	t.Parallel()

	request := imageRequestWithExtra(t, map[string]string{"resolution": "4K"})
	if got, ok, err := selectChannelBoundImageTierModel(
		"gpt-image-2",
		imageResolutionTier(request),
		[]string{"gpt-image-2", "gpt-image-2-official"},
		nil,
	); err == nil || ok {
		t.Fatalf("unexpected tier model %q", got)
	}
}

func TestSelectChannelBoundImageTierModelKeepsApimartBaseFor4K(t *testing.T) {
	t.Parallel()

	request := imageRequestWithExtra(t, map[string]string{"resolution": "4K"})
	got, ok, err := selectChannelBoundImageTierModel(
		"gpt-image-2",
		imageResolutionTier(request),
		[]string{"gpt-image-2", "gpt-image-2-pro"},
		imageTierRelayInfoWithChannelType("gpt-image-2", constant.ChannelTypeApimart),
	)
	if err != nil {
		t.Fatalf("selectChannelBoundImageTierModel error: %v", err)
	}
	if ok {
		t.Fatalf("unexpected tier model %q", got)
	}
}

func TestImageResolutionTierReadsMetadata(t *testing.T) {
	t.Parallel()

	metadata, err := json.Marshal(map[string]string{"imageSize": "4K"})
	if err != nil {
		t.Fatalf("marshal metadata: %v", err)
	}
	request := dto.ImageRequest{Extra: map[string]json.RawMessage{"metadata": metadata}}
	if got := imageResolutionTier(request); got != "4K" {
		t.Fatalf("imageResolutionTier = %q", got)
	}
}

func TestImageResolutionTierReadsPixelSize(t *testing.T) {
	t.Parallel()

	request := dto.ImageRequest{Size: "3840x2160"}
	if got := imageResolutionTier(request); got != "4K" {
		t.Fatalf("imageResolutionTier = %q", got)
	}
}

func TestApplyChannelBoundImageModelKeepsSelectedTierWhenMappingPointsToBase(t *testing.T) {
	t.Parallel()

	c := imageTierTestContext(
		[]string{"gpt-image-2", "gpt-image-2-vip"},
		`{"gpt-image-2-vip":"gpt-image-2"}`,
	)
	request := imageRequestWithExtra(t, map[string]string{"resolution": "2K"})
	request.Model = "gpt-image-2"
	info := imageTierRelayInfo("gpt-image-2")

	if err := applyChannelBoundImageModel(c, info, &request); err != nil {
		t.Fatalf("applyChannelBoundImageModel error: %v", err)
	}
	if request.Model != "gpt-image-2-vip" {
		t.Fatalf("request.Model = %q", request.Model)
	}
	if info.UpstreamModelName != "gpt-image-2-vip" {
		t.Fatalf("UpstreamModelName = %q", info.UpstreamModelName)
	}
}

func TestApplyChannelBoundImageModelMapsSelectedProTier(t *testing.T) {
	t.Parallel()

	c := imageTierTestContext(
		[]string{"gpt-image-2", "gpt-image-2-pro"},
		`{"gpt-image-2-pro":"gpt-image-2-pro-upstream"}`,
	)
	request := imageRequestWithExtra(t, map[string]string{"imageSize": "2K"})
	request.Model = "gpt-image-2"
	info := imageTierRelayInfo("gpt-image-2")

	if err := applyChannelBoundImageModel(c, info, &request); err != nil {
		t.Fatalf("applyChannelBoundImageModel error: %v", err)
	}
	if request.Model != "gpt-image-2-pro-upstream" {
		t.Fatalf("request.Model = %q", request.Model)
	}
	if info.UpstreamModelName != "gpt-image-2-pro-upstream" {
		t.Fatalf("UpstreamModelName = %q", info.UpstreamModelName)
	}
}

func TestApplyChannelBoundImageModelKeepsApimartBaseFor4K(t *testing.T) {
	t.Parallel()

	c := imageTierTestContext(
		[]string{"gpt-image-2", "gpt-image-2-pro"},
		`{"gpt-image-2":"gpt-image-2-pro"}`,
	)
	request := imageRequestWithExtra(t, map[string]string{"resolution": "4K"})
	request.Model = "gpt-image-2"
	info := imageTierRelayInfoWithChannelType("gpt-image-2", constant.ChannelTypeApimart)

	if err := applyChannelBoundImageModel(c, info, &request); err != nil {
		t.Fatalf("applyChannelBoundImageModel error: %v", err)
	}
	if request.Model != "gpt-image-2" {
		t.Fatalf("request.Model = %q", request.Model)
	}
	if info.UpstreamModelName != "gpt-image-2" {
		t.Fatalf("UpstreamModelName = %q", info.UpstreamModelName)
	}
}

func TestApplyChannelBoundImageModelMapsSelectedVipTierFor4K(t *testing.T) {
	t.Parallel()

	c := imageTierTestContext(
		[]string{"gpt-image-2", "gpt-image-2-vip"},
		`{"gpt-image-2-vip":"gpt-image-2-vip-upstream"}`,
	)
	request := imageRequestWithExtra(t, map[string]string{"resolution": "4K"})
	request.Model = "gpt-image-2"
	info := imageTierRelayInfo("gpt-image-2")

	if err := applyChannelBoundImageModel(c, info, &request); err != nil {
		t.Fatalf("applyChannelBoundImageModel error: %v", err)
	}
	if request.Model != "gpt-image-2-vip-upstream" {
		t.Fatalf("request.Model = %q", request.Model)
	}
	if info.UpstreamModelName != "gpt-image-2-vip-upstream" {
		t.Fatalf("UpstreamModelName = %q", info.UpstreamModelName)
	}
}

func TestApplyChannelBoundImageModelDoesNotUseOfficialTierForBaseRequest(t *testing.T) {
	t.Parallel()

	c := imageTierTestContext(
		[]string{"gpt-image-2", "gpt-image-2-official"},
		`{"gpt-image-2-official":"gpt-image-2"}`,
	)
	request := imageRequestWithExtra(t, map[string]string{"resolution": "4K"})
	request.Model = "gpt-image-2"
	info := imageTierRelayInfoWithChannelType("gpt-image-2", constant.ChannelTypeOpenAI)

	if err := applyChannelBoundImageModel(c, info, &request); err == nil {
		t.Fatal("expected applyChannelBoundImageModel to reject missing non-official tier")
	}
}

func TestApplyChannelBoundImageModelRejectsUnconfiguredExplicitOfficialOnApimartChannel(t *testing.T) {
	t.Parallel()

	c := imageTierTestContext(
		[]string{"gpt-image-2"},
		`{"gpt-image-2-official":"gpt-image-2"}`,
	)
	request := imageRequestWithExtra(t, map[string]string{"resolution": "4K"})
	request.Model = "gpt-image-2-official"
	info := imageTierRelayInfoWithChannelType("gpt-image-2-official", constant.ChannelTypeApimart)

	if err := applyChannelBoundImageModel(c, info, &request); err == nil {
		t.Fatal("expected applyChannelBoundImageModel to reject unconfigured official tier")
	}
}

func TestApplyChannelBoundImageModelRejectsOfficialOnNonApimartChannel(t *testing.T) {
	t.Parallel()

	c := imageTierTestContext(
		[]string{"gpt-image-2-official"},
		`{"gpt-image-2-official":"gpt-image-2"}`,
	)
	request := imageRequestWithExtra(t, map[string]string{"resolution": "4K"})
	request.Model = "gpt-image-2-official"
	info := imageTierRelayInfoWithChannelType("gpt-image-2-official", constant.ChannelTypeMagic666)

	if err := applyChannelBoundImageModel(c, info, &request); err == nil {
		t.Fatal("expected applyChannelBoundImageModel to reject non-APIMart official routing")
	}
}

func TestApplyChannelBoundImageModelDoesNotUseOfficialTierOnNonOfficialChannel(t *testing.T) {
	t.Parallel()

	c := imageTierTestContext(
		[]string{"gpt-image-2", "gpt-image-2-official"},
		`{"gpt-image-2-official":"gpt-image-2"}`,
	)
	request := imageRequestWithExtra(t, map[string]string{"resolution": "4K"})
	request.Model = "gpt-image-2"
	info := imageTierRelayInfoWithChannelType("gpt-image-2", constant.ChannelTypeMagic666)

	if err := applyChannelBoundImageModel(c, info, &request); err == nil {
		t.Fatal("expected applyChannelBoundImageModel to reject missing non-official tier")
	}
}

func TestApplyChannelBoundImageModelAllowsExplicitOfficial4KMappingToBaseOnApimartChannel(t *testing.T) {
	t.Parallel()

	c := imageTierTestContext(
		[]string{"gpt-image-2-official"},
		`{"gpt-image-2-official":"gpt-image-2"}`,
	)
	request := imageRequestWithExtra(t, map[string]string{"resolution": "4K"})
	request.Model = "gpt-image-2-official"
	info := imageTierRelayInfoWithChannelType("gpt-image-2-official", constant.ChannelTypeApimart)

	if err := applyChannelBoundImageModel(c, info, &request); err != nil {
		t.Fatalf("applyChannelBoundImageModel error: %v", err)
	}
	if request.Model != "gpt-image-2" {
		t.Fatalf("request.Model = %q", request.Model)
	}
	if info.UpstreamModelName != "gpt-image-2" {
		t.Fatalf("UpstreamModelName = %q", info.UpstreamModelName)
	}
}

func TestApplyChannelBoundImageModelAllowsExplicitOfficial4KPassthroughOnApimartChannel(t *testing.T) {
	t.Parallel()

	c := imageTierTestContext(
		[]string{"gpt-image-2-official"},
		`{}`,
	)
	request := imageRequestWithExtra(t, map[string]string{"resolution": "4K"})
	request.Model = "gpt-image-2-official"
	info := imageTierRelayInfoWithChannelType("gpt-image-2-official", constant.ChannelTypeApimart)

	if err := applyChannelBoundImageModel(c, info, &request); err != nil {
		t.Fatalf("applyChannelBoundImageModel error: %v", err)
	}
	if request.Model != "gpt-image-2-official" {
		t.Fatalf("request.Model = %q", request.Model)
	}
	if info.UpstreamModelName != "gpt-image-2-official" {
		t.Fatalf("UpstreamModelName = %q", info.UpstreamModelName)
	}
}

func TestApplyChannelBoundImageModelMapsGeminiOfficialOnApimartChannel(t *testing.T) {
	t.Parallel()

	c := imageTierTestContext(
		[]string{"gemini-3-pro-image-preview-official"},
		`{"gemini-3-pro-image-preview-official":"gemini-3-pro-image-preview"}`,
	)
	request := imageRequestWithExtra(t, map[string]string{"resolution": "4K"})
	request.Model = "gemini-3-pro-image-preview-official"
	info := imageTierRelayInfoWithChannelType("gemini-3-pro-image-preview-official", constant.ChannelTypeApimart)

	if err := applyChannelBoundImageModel(c, info, &request); err != nil {
		t.Fatalf("applyChannelBoundImageModel error: %v", err)
	}
	if request.Model != "gemini-3-pro-image-preview" {
		t.Fatalf("request.Model = %q", request.Model)
	}
	if info.UpstreamModelName != "gemini-3-pro-image-preview" {
		t.Fatalf("UpstreamModelName = %q", info.UpstreamModelName)
	}
}

func TestApplyChannelBoundImageModelMapsBaseWhenNoTierSelected(t *testing.T) {
	t.Parallel()

	c := imageTierTestContext(
		[]string{"gpt-image-2", "gpt-image-2-vip"},
		`{"gpt-image-2":"gpt-image-2-base-upstream"}`,
	)
	request := imageRequestWithExtra(t, map[string]string{"imageSize": "1K"})
	request.Model = "gpt-image-2"
	info := imageTierRelayInfo("gpt-image-2")

	if err := applyChannelBoundImageModel(c, info, &request); err != nil {
		t.Fatalf("applyChannelBoundImageModel error: %v", err)
	}
	if request.Model != "gpt-image-2-base-upstream" {
		t.Fatalf("request.Model = %q", request.Model)
	}
	if info.UpstreamModelName != "gpt-image-2-base-upstream" {
		t.Fatalf("UpstreamModelName = %q", info.UpstreamModelName)
	}
}

func imageRequestWithExtra(t *testing.T, values map[string]string) dto.ImageRequest {
	t.Helper()

	extra := make(map[string]json.RawMessage, len(values))
	for key, value := range values {
		data, err := json.Marshal(value)
		if err != nil {
			t.Fatalf("marshal %s: %v", key, err)
		}
		extra[key] = data
	}
	return dto.ImageRequest{Extra: extra}
}

func imageTierTestContext(channelModels []string, modelMapping string) *gin.Context {
	c, _ := gin.CreateTestContext(httptest.NewRecorder())
	common.SetContextKey(c, constant.ContextKeyChannelModels, channelModels)
	common.SetContextKey(c, constant.ContextKeyChannelModelMapping, modelMapping)
	return c
}

func imageTierRelayInfo(modelName string) *relaycommon.RelayInfo {
	return imageTierRelayInfoWithChannelType(modelName, constant.ChannelTypeUnknown)
}

func imageTierRelayInfoWithChannelType(modelName string, channelType int) *relaycommon.RelayInfo {
	return &relaycommon.RelayInfo{
		OriginModelName: modelName,
		ChannelMeta: &relaycommon.ChannelMeta{
			ChannelType:       channelType,
			UpstreamModelName: modelName,
		},
	}
}
