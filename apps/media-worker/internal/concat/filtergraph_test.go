// 镜像 hono-api video-concat.filtergraph.test.ts 的全部用例——
// 双端构建器输出必须逐字一致，任何一端改动都要让两套测试同时过。
package concat

import (
	"math"
	"strings"
	"testing"
)

var testDims = Dims{W: 1080, H: 1920}

func mkClip(over func(*ClipMeta)) ClipMeta {
	c := ClipMeta{DurationSec: 10, HasDuration: true, HasAudio: true, Transition: "fade"}
	if over != nil {
		over(&c)
	}
	return c
}

func filterComplexOf(t *testing.T, args []string) string {
	t.Helper()
	for i, a := range args {
		if a == "-filter_complex" {
			return args[i+1]
		}
	}
	t.Fatal("no -filter_complex in args")
	return ""
}

func TestFloorToFrameGrid(t *testing.T) {
	want := math.Floor(10.017*TargetFPS) / TargetFPS
	if got := FloorToFrameGrid(10.017); math.Abs(got-want) > 1e-6 {
		t.Fatalf("got %v want %v", got, want)
	}
	if got := FloorToFrameGrid(10); math.Abs(got-10) > 1e-6 {
		t.Fatalf("got %v", got)
	}
}

func TestSinglePassNullConditions(t *testing.T) {
	if BuildSinglePassConcatArgs(SinglePassInput{
		Clips: []ClipMeta{mkClip(nil), mkClip(nil)}, Dims: testDims, XfadeSeconds: 0, OutFile: "/tmp/out.mp4",
	}) != nil {
		t.Fatal("xfade disabled must return nil")
	}
	if BuildSinglePassConcatArgs(SinglePassInput{
		Clips: []ClipMeta{mkClip(nil), mkClip(func(c *ClipMeta) { c.HasDuration = false })},
		Dims:  testDims, XfadeSeconds: 0.4, OutFile: "/tmp/out.mp4",
	}) != nil {
		t.Fatal("unknown duration must return nil")
	}
	if BuildSinglePassConcatArgs(SinglePassInput{
		Clips: []ClipMeta{mkClip(nil)}, Dims: testDims, XfadeSeconds: 0.4, OutFile: "/tmp/out.mp4",
	}) != nil {
		t.Fatal("<2 clips must return nil")
	}
}

func TestSinglePassBasicChain(t *testing.T) {
	args := BuildSinglePassConcatArgs(SinglePassInput{
		Clips: []ClipMeta{mkClip(nil), mkClip(func(c *ClipMeta) { c.DurationSec = 8 })},
		Dims:  testDims, XfadeSeconds: 0.4, OutFile: "/tmp/out.mp4",
	})
	if args == nil {
		t.Fatal("expected args")
	}
	nInputs := 0
	for _, a := range args {
		if a == "-i" {
			nInputs++
		}
	}
	if nInputs != 2 {
		t.Fatalf("inputs = %d", nInputs)
	}
	fc := filterComplexOf(t, args)
	for _, want := range []string{
		"[0:v]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,setsar=1,fps=30[vn0]",
		"[vn0][vn1]xfade=transition=fade:duration=0.400:offset=9.600[vout]",
		"acrossfade=d=0.400[aout]",
		"apad,atrim=duration=10.000",
	} {
		if !strings.Contains(fc, want) {
			t.Fatalf("filter_complex missing %q\n%s", want, fc)
		}
	}
	if args[len(args)-1] != "/tmp/out.mp4" {
		t.Fatalf("last arg = %q", args[len(args)-1])
	}
}

func TestSinglePassOffsetsAccumulateOnFrameGrid(t *testing.T) {
	args := BuildSinglePassConcatArgs(SinglePassInput{
		Clips: []ClipMeta{
			mkClip(func(c *ClipMeta) { c.DurationSec = 10.017 }),
			mkClip(func(c *ClipMeta) { c.DurationSec = 8 }),
			mkClip(func(c *ClipMeta) { c.DurationSec = 6 }),
		},
		Dims: testDims, XfadeSeconds: 0.4, OutFile: "/tmp/out.mp4",
	})
	fc := filterComplexOf(t, args)
	d0 := FloorToFrameGrid(10.017)
	off1 := Fixed(d0-0.4, 3)
	off2 := Fixed(d0+8-0.8, 3)
	if !strings.Contains(fc, "xfade=transition=fade:duration=0.400:offset="+off1+"[v1]") {
		t.Fatalf("missing off1 %s in %s", off1, fc)
	}
	if !strings.Contains(fc, "xfade=transition=fade:duration=0.400:offset="+off2+"[vout]") {
		t.Fatalf("missing off2 %s", off2)
	}
}

func TestSinglePassSilentClipSynthesizesAudio(t *testing.T) {
	args := BuildSinglePassConcatArgs(SinglePassInput{
		Clips: []ClipMeta{mkClip(nil), mkClip(func(c *ClipMeta) { c.HasAudio = false; c.DurationSec = 8 })},
		Dims:  testDims, XfadeSeconds: 0.4, OutFile: "/tmp/out.mp4",
	})
	fc := filterComplexOf(t, args)
	if !strings.Contains(fc, "anullsrc=channel_layout=stereo:sample_rate=44100,atrim=duration=8.000[an1]") {
		t.Fatalf("missing anullsrc chain: %s", fc)
	}
	if strings.Contains(fc, "[1:a]") {
		t.Fatal("silent clip must not reference [1:a]")
	}
}

func TestSinglePassClampsCrossfadeToShortestClip(t *testing.T) {
	args := BuildSinglePassConcatArgs(SinglePassInput{
		Clips: []ClipMeta{mkClip(nil), mkClip(func(c *ClipMeta) { c.DurationSec = 0.5 })},
		Dims:  testDims, XfadeSeconds: 0.4, OutFile: "/tmp/out.mp4",
	})
	fc := filterComplexOf(t, args)
	if !strings.Contains(fc, "duration=0.200") {
		t.Fatalf("expected clamp to 0.200: %s", fc)
	}
}

func TestSinglePassTrimChains(t *testing.T) {
	args := BuildSinglePassConcatArgs(SinglePassInput{
		Clips: []ClipMeta{
			mkClip(func(c *ClipMeta) { c.DurationSec = 2; c.Trim = &ClipTrim{InSec: 1.5, OutSec: 3.5} }),
			mkClip(func(c *ClipMeta) { c.DurationSec = 8 }),
		},
		Dims: testDims, XfadeSeconds: 0.4, OutFile: "/tmp/out.mp4",
	})
	if args == nil {
		t.Fatal("expected args")
	}
	fc := filterComplexOf(t, args)
	for _, want := range []string{
		"[0:v]trim=start=1.500:end=3.500,setpts=PTS-STARTPTS,scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,setsar=1,fps=30[vn0]",
		"[0:a]atrim=start=1.500:end=3.500,asetpts=PTS-STARTPTS,aformat=sample_rates=44100:sample_fmts=fltp:channel_layouts=stereo,apad,atrim=duration=2.000[an0]",
		"[1:v]scale=1080:1920",
		"xfade=transition=fade:duration=0.400:offset=1.600[vout]",
	} {
		if !strings.Contains(fc, want) {
			t.Fatalf("missing %q\n%s", want, fc)
		}
	}
}

func TestSinglePassTrimSilentClip(t *testing.T) {
	args := BuildSinglePassConcatArgs(SinglePassInput{
		Clips: []ClipMeta{
			mkClip(nil),
			mkClip(func(c *ClipMeta) { c.HasAudio = false; c.DurationSec = 1; c.Trim = &ClipTrim{InSec: 4, OutSec: 5} }),
		},
		Dims: testDims, XfadeSeconds: 0.4, OutFile: "/tmp/out.mp4",
	})
	fc := filterComplexOf(t, args)
	if !strings.Contains(fc, "[1:v]trim=start=4.000:end=5.000,setpts=PTS-STARTPTS,scale=") {
		t.Fatalf("missing video trim: %s", fc)
	}
	if !strings.Contains(fc, "anullsrc=channel_layout=stereo:sample_rate=44100,atrim=duration=1.000[an1]") {
		t.Fatalf("missing anullsrc: %s", fc)
	}
	if strings.Contains(fc, "[1:a]") {
		t.Fatal("must not reference [1:a]")
	}
}

func TestSinglePassColorMatchFolded(t *testing.T) {
	args := BuildSinglePassConcatArgs(SinglePassInput{
		Clips: []ClipMeta{
			mkClip(func(c *ClipMeta) { c.Yuv = &YuvStats{Y: 100, U: 128, V: 128} }),
			mkClip(func(c *ClipMeta) { c.Yuv = &YuvStats{Y: 140, U: 128, V: 128} }),
		},
		Dims: testDims, XfadeSeconds: 0.4, ColorMatch: true, OutFile: "/tmp/out.mp4",
	})
	fc := filterComplexOf(t, args)
	if !strings.Contains(fc, "eq=brightness=0.0784") || !strings.Contains(fc, "eq=brightness=-0.0784") {
		t.Fatalf("missing brightness corrections: %s", fc)
	}
}

func TestSinglePassColorMatchSkippedOnMissingProbe(t *testing.T) {
	args := BuildSinglePassConcatArgs(SinglePassInput{
		Clips: []ClipMeta{
			mkClip(func(c *ClipMeta) { c.Yuv = &YuvStats{Y: 100, U: 128, V: 128} }),
			mkClip(nil),
		},
		Dims: testDims, XfadeSeconds: 0.4, ColorMatch: true, OutFile: "/tmp/out.mp4",
	})
	fc := filterComplexOf(t, args)
	if strings.Contains(fc, "eq=brightness") {
		t.Fatalf("color match must be skipped: %s", fc)
	}
}

func TestSinglePassPerClipTransition(t *testing.T) {
	args := BuildSinglePassConcatArgs(SinglePassInput{
		Clips: []ClipMeta{mkClip(nil), mkClip(func(c *ClipMeta) { c.Transition = "slideup" })},
		Dims:  testDims, XfadeSeconds: 0.4, OutFile: "/tmp/out.mp4",
	})
	fc := filterComplexOf(t, args)
	if !strings.Contains(fc, "xfade=transition=slideup:duration=0.400") {
		t.Fatalf("missing per-clip transition: %s", fc)
	}
}

func TestSinglePassUnknownTransitionIsRejected(t *testing.T) {
	args := BuildSinglePassConcatArgs(SinglePassInput{
		Clips: []ClipMeta{mkClip(nil), mkClip(func(c *ClipMeta) { c.Transition = "not-a-real-transition" })},
		Dims:  testDims, XfadeSeconds: 0.4, OutFile: "/tmp/out.mp4",
	})
	if args != nil {
		t.Fatalf("unknown transition must make explicit xfade unexecutable: %v", args)
	}
}

func TestSinglePassDifferentTransitionsPerClip(t *testing.T) {
	args := BuildSinglePassConcatArgs(SinglePassInput{
		Clips: []ClipMeta{
			mkClip(nil),
			mkClip(func(c *ClipMeta) { c.Transition = "circleopen" }),
			mkClip(func(c *ClipMeta) { c.Transition = "wipedown" }),
		},
		Dims: testDims, XfadeSeconds: 0.4, OutFile: "/tmp/out.mp4",
	})
	fc := filterComplexOf(t, args)
	if !strings.Contains(fc, "xfade=transition=circleopen") || !strings.Contains(fc, "xfade=transition=wipedown") {
		t.Fatalf("missing per-clip transitions: %s", fc)
	}
}

func TestBuildColorCorrectionsClamped(t *testing.T) {
	out := BuildColorCorrections([]*YuvStats{
		{Y: 0, U: 128, V: 128},
		{Y: 255, U: 128, V: 128},
	})
	if out == nil {
		t.Fatal("expected corrections")
	}
	if math.Abs(out[0].BOff-0.3) > 1e-6 || math.Abs(out[1].BOff+0.3) > 1e-6 {
		t.Fatalf("clamp failed: %+v %+v", out[0], out[1])
	}
}

func TestBuildColorCorrectionsNegligibleAndMissing(t *testing.T) {
	out := BuildColorCorrections([]*YuvStats{
		{Y: 120, U: 128, V: 128},
		{Y: 120.5, U: 128, V: 128},
	})
	if out == nil || out[0] != nil || out[1] != nil {
		t.Fatalf("negligible corrections must be nil entries: %+v", out)
	}
	if BuildColorCorrections([]*YuvStats{{Y: 120, U: 128, V: 128}, nil}) != nil {
		t.Fatal("missing probe must return nil")
	}
}

func TestResolveTargetDims(t *testing.T) {
	cases := []struct {
		aspect string
		first  *Dims
		want   Dims
	}{
		{"9:16", nil, Dims{1080, 1920}},
		{"16:9", nil, Dims{1920, 1080}},
		{"1:1", nil, Dims{1080, 1080}},
		{"4:3", nil, Dims{1440, 1080}},
		{"16:9", &Dims{W: 864, H: 496}, Dims{882, 496}},
		{"9:16", &Dims{W: 496, H: 864}, Dims{496, 882}},
		{"16:9", &Dims{W: 1280, H: 720}, Dims{1280, 720}},
		{"", &Dims{W: 1279, H: 721}, Dims{1280, 722}},
		{"garbage", nil, Dims{1080, 1920}},
	}
	for _, c := range cases {
		got := ResolveTargetDims(c.aspect, c.first)
		if got != c.want {
			t.Fatalf("ResolveTargetDims(%q,%v) = %v want %v", c.aspect, c.first, got, c.want)
		}
	}
}
