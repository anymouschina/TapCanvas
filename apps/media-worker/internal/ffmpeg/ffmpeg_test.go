package ffmpeg

import (
	"strings"
	"testing"
)

func TestPosterScaleFilterMatchesHonoApi(t *testing.T) {
	// 必须与 apps/hono-api/src/modules/asset/asset.video-poster.ts 的表达式逐字一致，
	// 否则切换 media-worker 前后 poster 尺寸行为漂移。
	want := "scale='if(gt(iw,ih),min(640,iw),-2)':'if(gt(iw,ih),-2,min(640,ih))'"
	if got := PosterScaleFilter(640); got != want {
		t.Fatalf("PosterScaleFilter(640) = %q, want %q", got, want)
	}
}

func TestParseFrameRate(t *testing.T) {
	cases := map[string]float64{
		"30000/1001": 29.97002997002997,
		"25/1":       25,
		"0/0":        0,
		"":           0,
		"24":         24,
	}
	for raw, want := range cases {
		got := parseFrameRate(raw)
		if (want == 0 && got != 0) || (want != 0 && (got < want-0.001 || got > want+0.001)) {
			t.Fatalf("parseFrameRate(%q) = %v, want %v", raw, got, want)
		}
	}
}

func TestTailBufferKeepsTail(t *testing.T) {
	tb := &tailBuffer{limit: 8}
	tb.Write([]byte("0123456789abcdef"))
	if got := tb.buf.String(); got != "89abcdef" {
		t.Fatalf("tail = %q", got)
	}
	if !strings.HasSuffix("0123456789abcdef", tb.buf.String()) {
		t.Fatal("tail must be suffix of input")
	}
}
