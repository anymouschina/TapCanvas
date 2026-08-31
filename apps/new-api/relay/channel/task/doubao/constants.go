package doubao

var ModelList = []string{
	"doubao-seedance-1-0-pro-250528",
	"doubao-seedance-1-0-lite-t2v",
	"doubao-seedance-1-0-lite-i2v",
	"doubao-seedance-1-5-pro-251215",
	"doubao-seedance-2-0-260128",
	"doubao-seedance-2-0-fast-260128",
	"doubao-seedance-2-5-260628",
	"doubao-seed3d-2-0-260328",
}

var ChannelName = "doubao-video"

// videoInputRatioMap 视频输入折扣比率（含视频单价 / 不含视频单价，官方 ¥/百万token 之比）。
// 仅作为 EstimateBilling 的回退路径：当模型没有发布 (分辨率×时长) 规格价表
// （model.VideoSpecPriceCNY 查不到）时，检测到视频输入才乘以此折扣。
// 有规格价表的模型统一按 spec_price 倍率计费（与画布用户实际扣分对齐）。
var videoInputRatioMap = map[string]float64{
	"doubao-seedance-2-0-260128":      28.0 / 46.0, // ~0.6087
	"doubao-seedance-2-0-fast-260128": 22.0 / 37.0, // ~0.5946
	"doubao-seedance-2-5-260628":      42.0 / 70.0, // 0.6
}

func GetVideoInputRatio(modelName string) (float64, bool) {
	r, ok := videoInputRatioMap[modelName]
	return r, ok
}
