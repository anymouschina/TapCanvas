package ali

import "testing"

func TestConvertAliImageSize(t *testing.T) {
	cases := []struct {
		name    string
		size    string
		res     string
		want    string
		wantErr bool
	}{
		// 空值：交上游按默认/原图比例
		{"empty", "", "", "", false},
		{"spaces", "   ", "2K", "", false},

		// 宽高比 × 分辨率档（空分辨率默认 2K）
		{"1:1 1K", "1:1", "1K", "1024*1024", false},
		{"1:1 2K", "1:1", "2K", "2048*2048", false},
		{"1:1 default->2K", "1:1", "", "2048*2048", false},
		{"16:9 1K", "16:9", "1K", "1280*720", false},
		{"16:9 2K", "16:9", "2K", "2048*1152", false},
		{"9:16 1K", "9:16", "1K", "720*1280", false},
		{"4:3 2K", "4:3", "2K", "2048*1536", false},
		{"3:4 1K", "3:4", "1K", "864*1152", false},
		{"3:2 2K", "3:2", "2K", "2048*1360", false},
		{"2:3 1K", "2:3", "1K", "832*1248", false},
		{"res lowercase", "1:1", "1k", "1024*1024", false},
		{"res unknown->2K", "1:1", "4K", "2048*2048", false},

		// 超宽比例：单档，忽略分辨率
		{"21:9 single", "21:9", "1K", "1792*768", false},
		{"9:21 single", "9:21", "2K", "768*1792", false},

		// 未知比例 -> 空
		{"ratio unknown -> empty", "5:7", "2K", "", false},

		// 显式宽高：x/X/* 归一化 + 范围内通过（分辨率被忽略）
		{"explicit x", "1024x1024", "", "1024*1024", false},
		{"explicit X", "1024X1536", "2K", "1024*1536", false},
		{"explicit star", "1664*928", "", "1664*928", false},
		{"explicit min", "512*512", "", "512*512", false},
		{"explicit max", "2048*2048", "", "2048*2048", false},

		// 越界：单边超范围
		{"side too small", "400*1024", "", "", true},
		{"side too large", "4096*1024", "", "", true},
		{"height too small", "1024*300", "", "", true},
		{"pixels below floor", "512*510", "", "", true}, // 510 < 512 -> 单边拦

		// 非法格式
		{"non-numeric", "abc*def", "", "", true},
		{"single token passthrough", "1024", "", "1024", false},
	}

	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			got, err := convertAliImageSize(c.size, c.res)
			if c.wantErr {
				if err == nil {
					t.Fatalf("convertAliImageSize(%q,%q) expected error, got %q", c.size, c.res, got)
				}
				return
			}
			if err != nil {
				t.Fatalf("convertAliImageSize(%q,%q) unexpected error: %v", c.size, c.res, err)
			}
			if got != c.want {
				t.Fatalf("convertAliImageSize(%q,%q) = %q, want %q", c.size, c.res, got, c.want)
			}
		})
	}
}

func TestPromptExtendDefaultsTrue(t *testing.T) {
	// 官方默认 prompt_extend=true：nil 必须按 true 处理（否则 z-image 2x 计费漏算）
	var nilParams *AliImageParameters
	if got := nilParams.PromptExtendValue(); got != true {
		t.Fatalf("nil receiver PromptExtendValue() = %v, want true", got)
	}
	empty := &AliImageParameters{}
	if got := empty.PromptExtendValue(); got != true {
		t.Fatalf("empty PromptExtendValue() = %v, want true", got)
	}
	f := false
	if got := (&AliImageParameters{PromptExtend: &f}).PromptExtendValue(); got != false {
		t.Fatalf("explicit false PromptExtendValue() = %v, want false", got)
	}
}
