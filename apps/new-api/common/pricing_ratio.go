package common

import "math"

// NormalizePriceRatio 归一价格系数：<=0（未设置 / 旧缓存 / 非法值）一律按 1.0（不打折）处理。
// 这是全链路的核心护栏：防止漏读倍率把账单清零。
func NormalizePriceRatio(ratio float64) float64 {
	if ratio <= 0 {
		return 1.0
	}
	return ratio
}

// ApplyDisplayRatio 按展示系数折算额度，仅用于"对外显示"，绝不用于真实扣减。
// 返回 round(quota × NormalizePriceRatio(ratio))。
func ApplyDisplayRatio(quota int, ratio float64) int {
	r := NormalizePriceRatio(ratio)
	return int(math.Round(float64(quota) * r))
}
