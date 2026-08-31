// ffmpeg/ffprobe 子进程包装。
//
// 语义对齐 hono-api subprocess-limits.ts：硬超时（默认 15min）到点 SIGKILL 整个进程组，
// 防挂死子进程孤儿化占满容器内存；stderr 只保尾部 8KB 进错误信息。
package ffmpeg

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"os/exec"
	"strconv"
	"strings"
	"syscall"
	"time"
)

const stderrTailLimit = 8 * 1024

type Runner struct {
	Timeout time.Duration
}

// tailBuffer 只保留最后 limit 字节，避免长转码的 stderr 无界增长。
type tailBuffer struct {
	limit int
	buf   bytes.Buffer
}

func (t *tailBuffer) Write(p []byte) (int, error) {
	t.buf.Write(p)
	if t.buf.Len() > t.limit {
		data := t.buf.Bytes()
		trimmed := make([]byte, t.limit)
		copy(trimmed, data[len(data)-t.limit:])
		t.buf.Reset()
		t.buf.Write(trimmed)
	}
	return len(p), nil
}

func (r *Runner) run(ctx context.Context, name string, args ...string) (string, error) {
	timeout := r.Timeout
	if timeout <= 0 {
		timeout = 15 * time.Minute
	}
	ctx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()

	cmd := exec.CommandContext(ctx, name, args...)
	// 独立进程组：超时/取消时连 ffmpeg fork 出的孙进程一起杀干净。
	cmd.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}
	cmd.Cancel = func() error {
		return syscall.Kill(-cmd.Process.Pid, syscall.SIGKILL)
	}

	var stdout bytes.Buffer
	stderr := &tailBuffer{limit: stderrTailLimit}
	cmd.Stdout = &stdout
	cmd.Stderr = stderr

	if err := cmd.Run(); err != nil {
		if ctx.Err() == context.DeadlineExceeded {
			return "", fmt.Errorf("%s timed out after %s: %s", name, timeout, strings.TrimSpace(stderr.buf.String()))
		}
		return "", fmt.Errorf("%s failed: %w: %s", name, err, strings.TrimSpace(stderr.buf.String()))
	}
	return stdout.String(), nil
}

func (r *Runner) Version(ctx context.Context) (string, error) {
	out, err := r.run(ctx, "ffmpeg", "-version")
	if err != nil {
		return "", err
	}
	line, _, _ := strings.Cut(out, "\n")
	return strings.TrimSpace(line), nil
}

// PosterScaleFilter 与 asset.video-poster.ts 的 scale 表达式逐字对齐：
// 长边 ≤maxEdge、不放大、另一边 -2 保偶数。
func PosterScaleFilter(maxEdge int) string {
	return fmt.Sprintf(
		"scale='if(gt(iw,ih),min(%d,iw),-2)':'if(gt(iw,ih),-2,min(%d,ih))'",
		maxEdge, maxEdge,
	)
}

// ExtractPoster 抽首帧写 jpg（-q:v 4，同 hono-api）。
func (r *Runner) ExtractPoster(ctx context.Context, videoPath, outPath string, maxEdge int) error {
	_, err := r.run(ctx, "ffmpeg",
		"-y",
		"-i", videoPath,
		"-frames:v", "1",
		"-vf", PosterScaleFilter(maxEdge),
		"-q:v", "4",
		outPath,
	)
	return err
}

// Run 暴露给上层跑任意 ffmpeg 参数（concat 单 pass args 由 concat 包构建）。
func (r *Runner) Run(ctx context.Context, args ...string) error {
	_, err := r.run(ctx, "ffmpeg", args...)
	return err
}

// ProbeDims 探视频尺寸；失败返回 ok=false（非致命，对齐 TS probeDims 返回 null）。
func (r *Runner) ProbeDims(ctx context.Context, path string) (w, h int, ok bool) {
	out, err := r.run(ctx, "ffprobe",
		"-v", "error",
		"-select_streams", "v:0",
		"-show_entries", "stream=width,height",
		"-of", "csv=p=0",
		path,
	)
	if err != nil {
		return 0, 0, false
	}
	line, _, _ := strings.Cut(strings.TrimSpace(out), "\n")
	parts := strings.Split(line, ",")
	if len(parts) < 2 {
		return 0, 0, false
	}
	wv, err1 := strconv.Atoi(strings.TrimSpace(parts[0]))
	hv, err2 := strconv.Atoi(strings.TrimSpace(parts[1]))
	if err1 != nil || err2 != nil || wv <= 0 || hv <= 0 {
		return 0, 0, false
	}
	return wv, hv, true
}

// HasAudioStream 对齐 TS hasAudioStream（失败按无音轨处理）。
func (r *Runner) HasAudioStream(ctx context.Context, path string) bool {
	out, err := r.run(ctx, "ffprobe",
		"-v", "error",
		"-select_streams", "a",
		"-show_entries", "stream=index",
		"-of", "csv=p=0",
		path,
	)
	if err != nil {
		return false
	}
	return strings.TrimSpace(out) != ""
}

// ProbeDurationSeconds 对齐 TS probeDurationSecond：2 位小数取整，失败 ok=false。
func (r *Runner) ProbeDurationSeconds(ctx context.Context, path string) (float64, bool) {
	out, err := r.run(ctx, "ffprobe",
		"-v", "error",
		"-show_entries", "format=duration",
		"-of", "csv=p=0",
		path,
	)
	if err != nil {
		return 0, false
	}
	d, err := strconv.ParseFloat(strings.TrimSpace(out), 64)
	if err != nil || d <= 0 {
		return 0, false
	}
	return mathRound2(d), true
}

func mathRound2(v float64) float64 {
	return float64(int64(v*100+0.5)) / 100
}

// ProbeAvgYUV 采样前 24 帧 signalstats 平均 Y/U/V（对齐 TS probeAvgYUV）；失败 ok=false。
func (r *Runner) ProbeAvgYUV(ctx context.Context, path string) (y, u, v float64, ok bool) {
	out, err := r.run(ctx, "ffprobe",
		"-v", "error",
		"-f", "lavfi",
		"-i", fmt.Sprintf("movie=%s,signalstats", path),
		"-show_entries", "frame_tags=lavfi.signalstats.YAVG,lavfi.signalstats.UAVG,lavfi.signalstats.VAVG",
		"-of", "csv=p=0",
		"-read_intervals", "%+#24",
	)
	if err != nil {
		return 0, 0, 0, false
	}
	var sums [3]float64
	rows := 0
	for _, line := range strings.Split(strings.TrimSpace(out), "\n") {
		parts := strings.Split(line, ",")
		if len(parts) < 3 {
			continue
		}
		var vals [3]float64
		bad := false
		for i := 0; i < 3; i++ {
			f, err := strconv.ParseFloat(strings.TrimSpace(parts[i]), 64)
			if err != nil {
				bad = true
				break
			}
			vals[i] = f
		}
		if bad {
			continue
		}
		for i := 0; i < 3; i++ {
			sums[i] += vals[i]
		}
		rows++
	}
	if rows == 0 {
		return 0, 0, 0, false
	}
	n := float64(rows)
	return sums[0] / n, sums[1] / n, sums[2] / n, true
}

// jsNum 对齐 JS 模板字符串里的 Number 序列化（String(0.3)="0.3"、String(1)="1"）。
func jsNum(v float64) string {
	return strconv.FormatFloat(v, 'f', -1, 64)
}

// ExtractLastFrame 对齐 extract-last-frame.ts：尾前 0.12s 抽 1 帧 png（-q:v 2）。
func (r *Runner) ExtractLastFrame(ctx context.Context, videoPath, outPath string) error {
	_, err := r.run(ctx, "ffmpeg",
		"-y",
		"-sseof", "-0.12",
		"-i", videoPath,
		"-vframes", "1",
		"-q:v", "2",
		outPath,
	)
	return err
}

// ExtractFrameWebpAt 对齐 extract-frames-at.ts：指定秒抽 1 帧 webp（quality 90）。
func (r *Runner) ExtractFrameWebpAt(ctx context.Context, videoPath string, timeSec float64, outPath string) error {
	_, err := r.run(ctx, "ffmpeg",
		"-y",
		"-ss", jsNum(timeSec),
		"-i", videoPath,
		"-frames:v", "1",
		"-c:v", "libwebp",
		"-quality", "90",
		outPath,
	)
	return err
}

// CopySegment 对齐 video-split-io：-ss 前置快速定位 + -c copy 无损切段。
func (r *Runner) CopySegment(ctx context.Context, videoPath string, startSec, durSec float64, outPath string) error {
	_, err := r.run(ctx, "ffmpeg",
		"-y",
		"-ss", jsNum(startSec),
		"-i", videoPath,
		"-t", jsNum(durSec),
		"-c", "copy",
		"-avoid_negative_ts", "make_zero",
		outPath,
	)
	return err
}

// TranscodeUnderstandingProxy 对齐 transcodeToUnderstandingProxy：≤1280宽 CRF30 veryfast + 64k AAC。
func (r *Runner) TranscodeUnderstandingProxy(ctx context.Context, videoPath, outPath string) error {
	_, err := r.run(ctx, "ffmpeg",
		"-y",
		"-i", videoPath,
		"-vf", "scale='min(1280,iw)':-2",
		"-c:v", "libx264",
		"-crf", "30",
		"-preset", "veryfast",
		"-c:a", "aac",
		"-b:a", "64k",
		"-movflags", "+faststart",
		outPath,
	)
	return err
}

type ProbeResult struct {
	DurationSeconds float64
	Width           int32
	Height          int32
	VideoCodec      string
	AudioCodec      string
	FPS             float64
	SizeBytes       int64
}

type ffprobeOutput struct {
	Format struct {
		Duration string `json:"duration"`
		Size     string `json:"size"`
	} `json:"format"`
	Streams []struct {
		CodecType    string `json:"codec_type"`
		CodecName    string `json:"codec_name"`
		Width        int32  `json:"width"`
		Height       int32  `json:"height"`
		AvgFrameRate string `json:"avg_frame_rate"`
	} `json:"streams"`
}

func parseFrameRate(raw string) float64 {
	num, den, found := strings.Cut(raw, "/")
	if !found {
		v, _ := strconv.ParseFloat(raw, 64)
		return v
	}
	n, err1 := strconv.ParseFloat(num, 64)
	d, err2 := strconv.ParseFloat(den, 64)
	if err1 != nil || err2 != nil || d == 0 {
		return 0
	}
	return n / d
}

func (r *Runner) Probe(ctx context.Context, mediaPath string) (*ProbeResult, error) {
	out, err := r.run(ctx, "ffprobe",
		"-v", "error",
		"-print_format", "json",
		"-show_format",
		"-show_streams",
		mediaPath,
	)
	if err != nil {
		return nil, err
	}
	var parsed ffprobeOutput
	if err := json.Unmarshal([]byte(out), &parsed); err != nil {
		return nil, fmt.Errorf("ffprobe output parse failed: %w", err)
	}
	result := &ProbeResult{}
	result.DurationSeconds, _ = strconv.ParseFloat(parsed.Format.Duration, 64)
	result.SizeBytes, _ = strconv.ParseInt(parsed.Format.Size, 10, 64)
	for _, s := range parsed.Streams {
		switch s.CodecType {
		case "video":
			if result.VideoCodec == "" {
				result.VideoCodec = s.CodecName
				result.Width = s.Width
				result.Height = s.Height
				result.FPS = parseFrameRate(s.AvgFrameRate)
			}
		case "audio":
			if result.AudioCodec == "" {
				result.AudioCodec = s.CodecName
			}
		}
	}
	return result, nil
}
