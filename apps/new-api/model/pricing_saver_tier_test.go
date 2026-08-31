package model

import "testing"

// 特价档（mlai-gemini 渠道，1 点 = ¥0.1）：1K=3pt 2K=3pt 4K=5pt。
func TestSaverTierImagePricing(t *testing.T) {
	const saver = "gemini-3-pro-image-preview-saver"
	cases := []struct {
		tier   string
		wantPt int
		want   float64
	}{
		{"1K", 3, 0.3},
		{"2K", 3, 0.3},
		{"4K", 5, 0.5},
	}
	for _, tc := range cases {
		got, ok := FixedImagePriceCNYForTier(saver, tc.tier)
		if !ok {
			t.Fatalf("%s %s：无固定定价规则，特价档会退回按 token 计费", saver, tc.tier)
		}
		if got != tc.want {
			t.Errorf("%s %s = ¥%.2f，期望 ¥%.2f（%d 点）", saver, tc.tier, got, tc.want, tc.wantPt)
		}
	}
}

// 特价档必须比普通渠道便宜、比极速档便宜——否则「特价」名不副实。
// 这条断言的价值在于：日后有人调普通价或极速价时，若把特价档比下去了，测试会红。
func TestSaverTierIsCheaperThanOtherTiers(t *testing.T) {
	tiers := []string{"1K", "2K", "4K"}
	for _, tier := range tiers {
		saver, ok := FixedImagePriceCNYForTier("gemini-3-pro-image-preview-saver", tier)
		if !ok {
			t.Fatalf("saver %s 缺定价", tier)
		}
		normal, ok := FixedImagePriceCNYForTier("gemini-3-pro-image-preview", tier)
		if !ok {
			t.Fatalf("普通档 %s 缺定价", tier)
		}
		ultra, ok := FixedImagePriceCNYForTier("gemini-3-pro-image-preview-ultra", tier)
		if !ok {
			t.Fatalf("极速档 %s 缺定价", tier)
		}
		if saver >= normal {
			t.Errorf("%s：特价 ¥%.2f 未低于普通 ¥%.2f", tier, saver, normal)
		}
		if saver >= ultra {
			t.Errorf("%s：特价 ¥%.2f 未低于极速 ¥%.2f", tier, saver, ultra)
		}
	}
}

// 最要命的一条：特价名绝不能被 CanonicalModelKey 折叠回底模键。
// 一旦折叠，fixedImagePricingRules 会 switch 到底模的 ¥0.7/0.7/0.9，
// 特价定价静默失效且不报错——只能靠账单发现，故用测试钉死。
func TestSaverTierNotCollapsedToBaseModel(t *testing.T) {
	const saver = "gemini-3-pro-image-preview-saver"
	if got := CanonicalModelKey(saver); got != saver {
		t.Fatalf("CanonicalModelKey(%q) = %q，特价名被折叠，定价将退回底模价", saver, got)
	}
	// 与底模键必须不同，否则两者共用同一条定价 case。
	if CanonicalModelKey(saver) == CanonicalModelKey("gemini-3-pro-image-preview") {
		t.Fatal("特价档与底模 canonical key 相同，定价必然合并")
	}
}
