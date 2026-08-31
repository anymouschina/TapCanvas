// 单 pass 视频拼接的 ffmpeg 参数构建器。
//
// 逐行移植自 hono-api video-concat.filtergraph.ts（含测试集镜像）——两端语义必须
// 逐字一致：滤镜链字符串、toFixed 位数、offset 计算、回退条件。改这里必须同步 TS。
package concat

import (
	"fmt"
	"math"
	"strconv"
	"strings"
)

const TargetFPS = 30
const TargetAR = 44100

type Dims struct {
	W int
	H int
}

type YuvStats struct {
	Y float64
	U float64
	V float64
}

type ClipTrim struct {
	InSec  float64
	OutSec float64
}

type ClipMeta struct {
	// 有效时长（秒）；探测失败为负数(<0) 表示未知 → 回退硬切管线。
	DurationSec float64
	HasDuration bool
	HasAudio    bool
	Yuv         *YuvStats
	Trim        *ClipTrim
	// 进入本段的 xfade 转场类型（第 0 段不适用，两段之间的转场记在后一段上）。
	// xfade 模式必须逐缝显式提供并命中白名单；hard_cut 模式不得携带。
	Transition string
}

// XfadeTransitions 是 ffmpeg xfade 支持的全部 58 种 transition 值
// （`ffmpeg -h filter=xfade`，对 ffmpeg 8.1.1 逐条比对过，与 TS 端逐字一致）。
// 白名单存在的意义是**在拼参数前挡掉非法值**——
// 非法 transition 会让整条 ffmpeg 命令失败，那时素材已经下载、额度已经花掉。
var XfadeTransitions = map[string]bool{
	"fade": true, "wipeleft": true, "wiperight": true, "wipeup": true, "wipedown": true,
	"slideleft": true, "slideright": true, "slideup": true, "slidedown": true,
	"circlecrop": true, "rectcrop": true, "distance": true, "fadeblack": true, "fadewhite": true,
	"radial": true, "smoothleft": true, "smoothright": true, "smoothup": true, "smoothdown": true,
	"circleopen": true, "circleclose": true, "vertopen": true, "vertclose": true,
	"horzopen": true, "horzclose": true, "dissolve": true, "pixelize": true,
	"diagtl": true, "diagtr": true, "diagbl": true, "diagbr": true,
	"hlslice": true, "hrslice": true, "vuslice": true, "vdslice": true,
	"hblur": true, "fadegrays": true, "wipetl": true, "wipetr": true, "wipebl": true, "wipebr": true,
	"squeezeh": true, "squeezev": true, "zoomin": true, "fadefast": true, "fadeslow": true,
	"hlwind": true, "hrwind": true, "vuwind": true, "vdwind": true,
	"coverleft": true, "coverright": true, "coverup": true, "coverdown": true,
	"revealleft": true, "revealright": true, "revealup": true, "revealdown": true,
}

// ResolveTransition 解析进入某段的显式转场类型；第二个返回值说明是否有效。
func ResolveTransition(name string) (string, bool) {
	trimmed := strings.TrimSpace(name)
	return trimmed, XfadeTransitions[trimmed]
}

type ColorCorrection struct {
	BOff float64
	Rm   float64
	Bm   float64
}

func clampSigned(v, lim float64) float64 {
	if math.IsNaN(v) || math.IsInf(v, 0) {
		return 0
	}
	return math.Max(-lim, math.Min(lim, v))
}

// fixed 对齐 JS Number.prototype.toFixed（half-away-from-zero）。
func fixed(v float64, digits int) string {
	pow := math.Pow(10, float64(digits))
	rounded := math.Round(math.Abs(v)*pow) / pow
	if v < 0 {
		rounded = -rounded
	}
	return strconv.FormatFloat(rounded, 'f', digits, 64)
}

// FloorToFrameGrid 把时长向下取整到目标帧率的帧网格上（防 xfade offset 越界）。
func FloorToFrameGrid(durationSec float64) float64 {
	return math.Floor(durationSec*TargetFPS) / TargetFPS
}

// BuildColorCorrections 跨镜色彩匹配参数。任一段探测失败 → nil（整体跳过）；
// 单段偏差可忽略 → 该位置为 nil。
func BuildColorCorrections(stats []*YuvStats) []*ColorCorrection {
	for _, s := range stats {
		if s == nil {
			return nil
		}
	}
	n := float64(len(stats))
	var tY, tU, tV float64
	for _, s := range stats {
		tY += s.Y
		tU += s.U
		tV += s.V
	}
	tY /= n
	tU /= n
	tV /= n
	out := make([]*ColorCorrection, len(stats))
	for i, s := range stats {
		bOff := clampSigned((tY-s.Y)/255, 0.3)
		rm := clampSigned(((tV-s.V)/255)*0.6, 0.3)
		bm := clampSigned(((tU-s.U)/255)*0.6, 0.3)
		if math.Abs(bOff) < 0.01 && math.Abs(rm) < 0.01 && math.Abs(bm) < 0.01 {
			out[i] = nil
			continue
		}
		out[i] = &ColorCorrection{BOff: bOff, Rm: rm, Bm: bm}
	}
	return out
}

// ColorFilterOf eq/colorbalance 滤镜片段（含前导逗号），无需校正时为空串。
func ColorFilterOf(corr *ColorCorrection) string {
	if corr == nil {
		return ""
	}
	return fmt.Sprintf(",eq=brightness=%s,colorbalance=rm=%s:bm=%s",
		fixed(corr.BOff, 4), fixed(corr.Rm, 4), fixed(corr.Bm, 4))
}

type SinglePassInput struct {
	Clips        []ClipMeta
	Files        []string
	Dims         Dims
	XfadeSeconds float64
	ColorMatch   bool
	OutFile      string
}

// BuildSinglePassConcatArgs 构建显式 xfade 的完整 ffmpeg 参数。
// 返回 nil 表示该显式策略不可执行；调用方必须报错，不能静默改成 hard_cut。
func BuildSinglePassConcatArgs(input SinglePassInput) []string {
	clips := input.Clips
	if len(clips) < 2 || input.XfadeSeconds <= 0 {
		return nil
	}
	for _, c := range clips {
		if !c.HasDuration || c.DurationSec <= 0 {
			return nil
		}
	}

	durations := make([]float64, len(clips))
	minDur := math.Inf(1)
	for i, c := range clips {
		durations[i] = FloorToFrameGrid(c.DurationSec)
		minDur = math.Min(minDur, durations[i])
	}
	// 每段叠化时长不得超过最短片段 ~40%，否则 xfade offset 为负/超片段长会报错。
	t := math.Min(input.XfadeSeconds, math.Max(0.1, minDur*0.4))
	if t < 0.1 {
		return nil
	}

	var corrections []*ColorCorrection
	if input.ColorMatch {
		stats := make([]*YuvStats, len(clips))
		for i, c := range clips {
			stats[i] = c.Yuv
		}
		corrections = BuildColorCorrections(stats)
	}

	var chains []string
	for i, c := range clips {
		color := ""
		if corrections != nil {
			color = ColorFilterOf(corrections[i])
		}
		vTrim := ""
		if c.Trim != nil {
			vTrim = fmt.Sprintf("trim=start=%s:end=%s,setpts=PTS-STARTPTS,",
				fixed(c.Trim.InSec, 3), fixed(c.Trim.OutSec, 3))
		}
		chains = append(chains, fmt.Sprintf(
			"[%d:v]%sscale=%d:%d:force_original_aspect_ratio=increase,crop=%d:%d,setsar=1,fps=%d%s[vn%d]",
			i, vTrim, input.Dims.W, input.Dims.H, input.Dims.W, input.Dims.H, TargetFPS, color, i))
		dur := fixed(durations[i], 3)
		if c.HasAudio {
			aTrim := ""
			if c.Trim != nil {
				aTrim = fmt.Sprintf("atrim=start=%s:end=%s,asetpts=PTS-STARTPTS,",
					fixed(c.Trim.InSec, 3), fixed(c.Trim.OutSec, 3))
			}
			chains = append(chains, fmt.Sprintf(
				"[%d:a]%saformat=sample_rates=%d:sample_fmts=fltp:channel_layouts=stereo,apad,atrim=duration=%s[an%d]",
				i, aTrim, TargetAR, dur, i))
		} else {
			chains = append(chains, fmt.Sprintf(
				"anullsrc=channel_layout=stereo:sample_rate=%d,atrim=duration=%s[an%d]",
				TargetAR, dur, i))
		}
	}

	ts := fixed(t, 3)
	vPrev := "vn0"
	aPrev := "an0"
	cum := 0.0
	last := len(clips) - 1
	for i := 1; i < len(clips); i++ {
		cum += durations[i-1]
		offset := fixed(cum-float64(i)*t, 3)
		vOut := fmt.Sprintf("v%d", i)
		aOut := fmt.Sprintf("a%d", i)
		if i == last {
			vOut = "vout"
			aOut = "aout"
		}
		// 两段之间的转场记在后一段上；音频侧始终 acrossfade（xfade 只管画面）。
		transition, validTransition := ResolveTransition(clips[i].Transition)
		if !validTransition {
			return nil
		}
		chains = append(chains, fmt.Sprintf(
			"[%s][vn%d]xfade=transition=%s:duration=%s:offset=%s[%s]", vPrev, i, transition, ts, offset, vOut))
		chains = append(chains, fmt.Sprintf("[%s][an%d]acrossfade=d=%s[%s]", aPrev, i, ts, aOut))
		vPrev = vOut
		aPrev = aOut
	}

	args := []string{"-y"}
	for i := range clips {
		file := ""
		if input.Files != nil && i < len(input.Files) {
			file = input.Files[i]
		}
		args = append(args, "-i", file)
	}
	args = append(args,
		"-filter_complex", strings.Join(chains, ";"),
		"-map", "[vout]",
		"-map", "[aout]",
		"-c:v", "libx264",
		"-preset", "medium",
		"-pix_fmt", "yuv420p",
		"-c:a", "aac",
		"-ar", strconv.Itoa(TargetAR),
		"-ac", "2",
		"-movflags", "+faststart",
		input.OutFile,
	)
	return args
}

// MakeEven 四舍五入到最近偶数（向上补 1）。
func MakeEven(n float64) int {
	r := int(math.Round(n))
	if r%2 == 0 {
		return r
	}
	return r + 1
}

// ResolveTargetDims 对齐 video-concat.ts：targetAspect 只锁定方向/比例，
// 短边沿用首段真实分辨率，避免 480p 源片因为传了 16:9 就被无意义上采样到 1080p。
// 首段不可探测时才用 1080 短边兜底；无效比例则保留首段实际尺寸。
func ResolveTargetDims(targetAspect string, firstClip *Dims) Dims {
	trimmed := strings.TrimSpace(targetAspect)
	if trimmed != "" {
		normalized := trimmed
		for _, sep := range []string{"：", "x", "×", "/"} {
			normalized = strings.ReplaceAll(normalized, sep, ":")
		}
		parts := strings.SplitN(normalized, ":", 2)
		if len(parts) == 2 {
			a, errA := strconv.ParseFloat(strings.TrimSpace(parts[0]), 64)
			b, errB := strconv.ParseFloat(strings.TrimSpace(parts[1]), 64)
			if errA == nil && errB == nil && a > 0 && b > 0 {
				short := float64(1080)
				if firstClip != nil && firstClip.W > 0 && firstClip.H > 0 {
					short = math.Min(float64(firstClip.W), float64(firstClip.H))
				}
				if a >= b {
					return Dims{W: MakeEven(short * a / b), H: MakeEven(short)}
				}
				return Dims{W: MakeEven(short), H: MakeEven(short * b / a)}
			}
		}
	}
	if firstClip != nil && firstClip.W > 0 && firstClip.H > 0 {
		return Dims{W: MakeEven(float64(firstClip.W)), H: MakeEven(float64(firstClip.H))}
	}
	return Dims{W: 1080, H: 1920}
}

// NormalizeVF 显式硬切路径的逐段 normalize -vf 串（对齐 normalizeClip）。
func NormalizeVF(dims Dims, colorFilter string) string {
	return fmt.Sprintf(
		"scale=%d:%d:force_original_aspect_ratio=increase,crop=%d:%d,setsar=1,fps=%d%s",
		dims.W, dims.H, dims.W, dims.H, TargetFPS, colorFilter)
}

// Fixed 导出 toFixed 对齐工具（server 拼 -ss/-t 参数用）。
func Fixed(v float64, digits int) string {
	return fixed(v, digits)
}
