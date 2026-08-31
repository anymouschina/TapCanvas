package common

import "testing"

func TestNormalizePriceRatio(t *testing.T) {
	cases := []struct {
		in   float64
		want float64
	}{
		{0, 1},     // 未设 → 1.0（护栏）
		{-0.5, 1},  // 非法负数 → 1.0
		{1, 1},     // 原价
		{0.8, 0.8}, // 打八折
		{1.5, 1.5}, // 允许加价
	}
	for _, c := range cases {
		if got := NormalizePriceRatio(c.in); got != c.want {
			t.Fatalf("NormalizePriceRatio(%v) = %v, want %v", c.in, got, c.want)
		}
	}
}

func TestApplyDisplayRatio(t *testing.T) {
	cases := []struct {
		quota int
		ratio float64
		want  int
	}{
		{80, 0.5, 40}, // 真实80 × 0.5 = 40
		{80, 1, 80},   // 原价
		{80, 0, 80},   // 0 视为 1.0（不打折）
		{80, -1, 80},  // 非法负数 → 1.0
		{3, 0.5, 2},   // 1.5 四舍五入到 2
		{1, 0.4, 0},   // 0.4 四舍五入到 0（允许为0）
	}
	for _, c := range cases {
		if got := ApplyDisplayRatio(c.quota, c.ratio); got != c.want {
			t.Fatalf("ApplyDisplayRatio(%d, %v) = %d, want %d", c.quota, c.ratio, got, c.want)
		}
	}
}
