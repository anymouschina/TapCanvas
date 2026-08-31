package volcengine

import (
	"errors"
	"testing"

	"github.com/QuantumNous/new-api/constant"
)

func TestRequiresArkModeration(t *testing.T) {
	t.Setenv("VOLC_ARK_ACCESS_KEY", "ak")
	t.Setenv("VOLC_ARK_SECRET_KEY", "sk")
	volc := constant.ChannelTypeVolcEngine
	cases := []struct {
		name  string
		ch    int
		model string
		img   bool
		want  bool
	}{
		{"ark+seedance2.0+img", volc, "doubao-seedance-2.0", true, true},
		{"ark+seedance2-0-dated+img", volc, "doubao-seedance-2-0-260128", true, true},
		{"ark+seedance2.0-fast+img", volc, "doubao-seedance-2.0-fast", true, true},
		{"ark+seedance2.5+img", volc, "doubao-seedance-2.5", true, true},
		{"ark+seedance2-5-dated+img", volc, "doubao-seedance-2-5-260628", true, true},
		{"ark+seedance2.6+img", volc, "doubao-seedance-2.6", true, false},
		{"ark+seedance2.0+noimg", volc, "doubao-seedance-2.0", false, false},
		{"ark+face", volc, "doubao-seedance-2.0-face", true, false},
		{"ark+apimart", volc, "doubao-seedance-2.0-apimart", true, false},
		{"ark+seedream", volc, "doubao-seedream-5-0", true, false},
		{"nonark+seedance2.0", 1, "doubao-seedance-2.0", true, false},
	}
	for _, tc := range cases {
		if got := RequiresArkModeration(tc.ch, tc.model, tc.img); got != tc.want {
			t.Errorf("%s: got %v want %v", tc.name, got, tc.want)
		}
	}
}

func TestRequiresArkModerationUnconfigured(t *testing.T) {
	t.Setenv("VOLC_ARK_ACCESS_KEY", "")
	t.Setenv("VOLC_ARK_SECRET_KEY", "")
	if RequiresArkModeration(constant.ChannelTypeVolcEngine, "doubao-seedance-2.0", true) {
		t.Fatal("未配置 VOLC_ARK_* 时不应触发审核")
	}
}

func TestRequiresArkAssetUploadOnlyMatchesOfficialChannel(t *testing.T) {
	t.Setenv("VOLC_ARK_ACCESS_KEY", "ak")
	t.Setenv("VOLC_ARK_SECRET_KEY", "sk")
	if !RequiresArkAssetUpload(constant.ChannelTypeVolcEngine, "doubao-seedance-2-5-260628") {
		t.Fatal("VolcEngine Seedance 2.x 官渠应触发 ARK 素材上传")
	}
	if RequiresArkAssetUpload(1, "doubao-seedance-2-5-260628") {
		t.Fatal("非 VolcEngine 渠道不应触发 ARK 素材上传")
	}
	if RequiresArkAssetUpload(constant.ChannelTypeVolcEngine, "doubao-seedance-1-5-pro") {
		t.Fatal("非 Seedance 2.x 模型不应触发 ARK 素材上传")
	}
}

func TestArkModerationErrorClassification(t *testing.T) {
	var me *ArkModerationError
	if !errors.As(error(newArkRejected("rejected x")), &me) || !me.Rejected {
		t.Fatal("rejected 分类错误")
	}
	me = nil
	if !errors.As(error(newArkUnavailable("tech y")), &me) || me.Rejected {
		t.Fatal("unavailable 分类错误")
	}
}

func TestCreateAssetRequestBodyUsesRequestedMediaType(t *testing.T) {
	cfg := arkConfig{projectName: "project"}
	for _, assetType := range []ArkAssetType{ArkAssetTypeImage, ArkAssetTypeVideo, ArkAssetTypeAudio} {
		body := createAssetRequestBody(cfg, "group", "https://example.com/media", assetType)
		if got := body["AssetType"]; got != string(assetType) {
			t.Fatalf("AssetType = %v, want %q", got, assetType)
		}
	}
}

func TestModerateSeedanceAssetsPreservesExistingAssetReferences(t *testing.T) {
	t.Setenv("VOLC_ARK_ACCESS_KEY", "ak")
	t.Setenv("VOLC_ARK_SECRET_KEY", "sk")
	inputs := []SeedanceAssetInput{
		{URL: "asset://image-id", Type: ArkAssetTypeImage},
		{URL: "asset://video-id", Type: ArkAssetTypeVideo},
		{URL: "asset://audio-id", Type: ArkAssetTypeAudio},
	}
	got, err := ModerateSeedanceAssets(inputs)
	if err != nil {
		t.Fatalf("ModerateSeedanceAssets returned error: %v", err)
	}
	for i := range inputs {
		if got[i] != inputs[i].URL {
			t.Fatalf("result[%d] = %q, want %q", i, got[i], inputs[i].URL)
		}
	}
}
