// M2 RPC 实现：ConcatVideos / MuxAudio / ExtractLastFrame / ExtractFramesAt /
// SplitVideo / TranscodeProxy。
//
// 每个方法与 hono-api 对应 TS 实现逐项对齐（ffmpeg 参数、key 布局、探测失败降级），
// TS 侧保留为回退路径——改任何一端语义必须双端同步。
package server

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"sync"
	"time"

	"github.com/google/uuid"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"

	tapmediav1 "tapcanvas/media-worker/gen/tapmedia/v1"
	"tapcanvas/media-worker/internal/concat"
)

const immutableCache = "public, max-age=31536000, immutable"

// 片段下载并发上限（对齐 video-concat.ts DOWNLOAD_CONCURRENCY）。
const downloadConcurrency = 4

var unsafeUserChars = regexp.MustCompile(`[^a-zA-Z0-9_-]`)

func safeUserSegment(userID string) string {
	return unsafeUserChars.ReplaceAllString(userID, "_")
}

func datePrefix(now time.Time) string {
	return now.UTC().Format("20060102")
}

type concatIdentityClip struct {
	URL        string   `json:"url"`
	InSec      *float64 `json:"inSec"`
	OutSec     *float64 `json:"outSec"`
	Transition string   `json:"transition"`
}

type concatIdentityContract struct {
	Version      int                  `json:"version"`
	UserID       string               `json:"userId"`
	TargetAspect string               `json:"targetAspect"`
	XfadeSeconds float64              `json:"xfadeSeconds"`
	ColorMatch   bool                 `json:"colorMatch"`
	Clips        []concatIdentityClip `json:"clips"`
}

func concatOutputKey(req *tapmediav1.ConcatVideosRequest) (string, error) {
	contract := concatIdentityContract{
		Version:      1,
		UserID:       strings.TrimSpace(req.GetUserId()),
		TargetAspect: strings.TrimSpace(req.GetTargetAspect()),
		XfadeSeconds: req.GetXfadeSeconds(),
		ColorMatch:   req.GetColorMatch(),
		Clips:        make([]concatIdentityClip, len(req.GetClips())),
	}
	for index, clip := range req.GetClips() {
		contract.Clips[index] = concatIdentityClip{
			URL:        strings.TrimSpace(clip.GetUrl()),
			InSec:      clip.InSec,
			OutSec:     clip.OutSec,
			Transition: strings.TrimSpace(clip.GetTransition()),
		}
	}
	payload, err := json.Marshal(contract)
	if err != nil {
		return "", fmt.Errorf("marshal concat identity: %w", err)
	}
	digest := sha256.Sum256(payload)
	return fmt.Sprintf(
		"gen/videos/%s/workflow-concat/%s.mp4",
		safeUserSegment(contract.UserID),
		hex.EncodeToString(digest[:]),
	), nil
}

// mapWithConcurrency 对齐 TS 版：结果顺序与 items 一致，任一项失败即整体失败。
func mapWithConcurrency(items []string, limit int, fn func(item string, index int) error) error {
	if limit < 1 {
		limit = 1
	}
	if limit > len(items) {
		limit = len(items)
	}
	var (
		mu       sync.Mutex
		firstErr error
		next     int
		wg       sync.WaitGroup
	)
	for w := 0; w < limit; w++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for {
				mu.Lock()
				if firstErr != nil || next >= len(items) {
					mu.Unlock()
					return
				}
				i := next
				next++
				mu.Unlock()
				if err := fn(items[i], i); err != nil {
					mu.Lock()
					if firstErr == nil {
						firstErr = err
					}
					mu.Unlock()
					return
				}
			}
		}()
	}
	wg.Wait()
	return firstErr
}

func jsNum(v float64) string {
	return strings.TrimRight(strings.TrimRight(fmt.Sprintf("%f", v), "0"), ".")
}

// ── ConcatVideos ─────────────────────────────────────────────────────────

type sourceMeta struct {
	hasAudio    bool
	durationSec float64
	hasDuration bool
	yuv         *concat.YuvStats
}

func (s *MediaServer) ConcatVideos(ctx context.Context, req *tapmediav1.ConcatVideosRequest) (*tapmediav1.ConcatVideosResponse, error) {
	store, err := s.requireStore()
	if err != nil {
		return nil, err
	}
	clips := req.GetClips()
	if len(clips) < 2 {
		return nil, status.Error(codes.InvalidArgument, "clips must contain at least 2 entries")
	}
	userID := strings.TrimSpace(req.GetUserId())
	if userID == "" {
		return nil, status.Error(codes.InvalidArgument, "user_id is required")
	}
	xfadeSeconds := req.GetXfadeSeconds()
	if xfadeSeconds < 0 || xfadeSeconds > 1.2 {
		return nil, status.Errorf(codes.InvalidArgument,
			"xfade_seconds must be within [0, 1.2], got %v", xfadeSeconds)
	}
	// 校验对齐 normalizeClipSpecs（Node 端也校验过；worker 不信任调用方重复校验）。
	for i, c := range clips {
		if strings.TrimSpace(c.GetUrl()) == "" {
			return nil, status.Errorf(codes.InvalidArgument, "clips[%d]: url is required", i)
		}
		if c.InSec != nil && *c.InSec < 0 {
			return nil, status.Errorf(codes.InvalidArgument, "clips[%d]: in_sec must be non-negative", i)
		}
		if c.OutSec != nil && *c.OutSec <= 0 {
			return nil, status.Errorf(codes.InvalidArgument, "clips[%d]: out_sec must be positive", i)
		}
		if c.InSec != nil && c.OutSec != nil && *c.OutSec-*c.InSec < 0.1 {
			return nil, status.Errorf(codes.InvalidArgument, "clips[%d]: out_sec must exceed in_sec by at least 0.1s", i)
		}
		transition := strings.TrimSpace(c.GetTransition())
		if i == 0 && transition != "" {
			return nil, status.Error(codes.InvalidArgument,
				"clips[0]: transition is invalid because the first clip has no incoming seam")
		}
		if i > 0 && xfadeSeconds <= 0 && transition != "" {
			return nil, status.Errorf(codes.InvalidArgument,
				"clips[%d]: transition requires a positive xfade_seconds", i)
		}
		if i > 0 && xfadeSeconds > 0 && transition == "" {
			return nil, status.Errorf(codes.InvalidArgument,
				"clips[%d]: transition is required when xfade_seconds is positive", i)
		}
		// 转场非法值在入口就拒：此刻素材还没下载，比让 ffmpeg 在合成末尾失败便宜。
		if transition != "" && !concat.XfadeTransitions[transition] {
			return nil, status.Errorf(codes.InvalidArgument,
				"clips[%d]: unknown transition %q; must be an ffmpeg xfade transition", i, transition)
		}
	}
	outputKey, err := concatOutputKey(req)
	if err != nil {
		return nil, status.Errorf(codes.Internal, "derive concat output identity: %v", err)
	}
	if existingBytes, exists, headErr := store.ObjectSize(ctx, outputKey); headErr != nil {
		return nil, status.Errorf(codes.Internal, "reconcile concat output: %v", headErr)
	} else if exists {
		return &tapmediav1.ConcatVideosResponse{
			Key:       outputKey,
			Url:       store.PublicURL(outputKey),
			Bytes:     existingBytes,
			ClipCount: int32(len(clips)),
		}, nil
	}

	release, err := s.acquireJobSlot(ctx)
	if err != nil {
		return nil, err
	}
	defer release()

	dir, err := os.MkdirTemp("", "tapmedia-concat-")
	if err != nil {
		return nil, status.Errorf(codes.Internal, "mkdtemp: %v", err)
	}
	defer os.RemoveAll(dir)

	// 1. 按 URL 去重并行下载（有界并发）。
	var uniqueUrls []string
	fileByURL := map[string]string{}
	for _, c := range clips {
		u := strings.TrimSpace(c.GetUrl())
		if _, seen := fileByURL[u]; !seen {
			fileByURL[u] = filepath.Join(dir, fmt.Sprintf("raw-%d.mp4", len(uniqueUrls)))
			uniqueUrls = append(uniqueUrls, u)
		}
	}
	if err := mapWithConcurrency(uniqueUrls, downloadConcurrency, func(u string, _ int) error {
		return store.SmartDownloadToFile(ctx, u, fileByURL[u])
	}); err != nil {
		return nil, status.Errorf(codes.Internal, "download clips: %v", err)
	}
	rawFiles := make([]string, len(clips))
	for i, c := range clips {
		rawFiles[i] = fileByURL[strings.TrimSpace(c.GetUrl())]
	}

	// 2. 并行探测：首段尺寸 + 每源音轨/时长/平均YUV（失败非致命，对齐 TS）。
	colorMatch := req.GetColorMatch()
	metaByURL := make(map[string]*sourceMeta, len(uniqueUrls))
	var metaMu sync.Mutex
	_ = mapWithConcurrency(uniqueUrls, downloadConcurrency, func(u string, _ int) error {
		f := fileByURL[u]
		m := &sourceMeta{}
		m.hasAudio = s.runner.HasAudioStream(ctx, f)
		m.durationSec, m.hasDuration = s.runner.ProbeDurationSeconds(ctx, f)
		if colorMatch {
			if y, uu, v, ok := s.runner.ProbeAvgYUV(ctx, f); ok {
				m.yuv = &concat.YuvStats{Y: y, U: uu, V: v}
			}
		}
		metaMu.Lock()
		metaByURL[u] = m
		metaMu.Unlock()
		return nil
	})
	var firstDims *concat.Dims
	if w, h, ok := s.runner.ProbeDims(ctx, rawFiles[0]); ok {
		firstDims = &concat.Dims{W: w, H: h}
	}
	if colorMatch {
		for _, sourceURL := range uniqueUrls {
			if metaByURL[sourceURL] == nil || metaByURL[sourceURL].yuv == nil {
				return nil, status.Error(codes.FailedPrecondition,
					"video_concat_color_match_probe_failed")
			}
		}
	}

	// 3. 每个拼接段的有效元数据：trim 区间夹到源时长内（对齐 TS clipMetas）。
	clipMetas := make([]concat.ClipMeta, len(clips))
	for i, c := range clips {
		src := metaByURL[strings.TrimSpace(c.GetUrl())]
		meta := concat.ClipMeta{
			HasAudio:    src.hasAudio,
			Yuv:         src.yuv,
			DurationSec: src.durationSec,
			HasDuration: src.hasDuration,
			Transition:  c.GetTransition(),
		}
		if c.InSec == nil && c.OutSec == nil {
			clipMetas[i] = meta
			continue
		}
		inSec := 0.0
		if c.InSec != nil && *c.InSec > 0 {
			inSec = *c.InSec
		}
		var outSec float64
		hasOut := false
		if c.OutSec != nil {
			outSec = *c.OutSec
			if src.hasDuration && src.durationSec < outSec {
				outSec = src.durationSec
			}
			hasOut = true
		} else if src.hasDuration {
			outSec = src.durationSec
			hasOut = true
		}
		if hasOut && outSec-inSec < 0.1 {
			return nil, status.Errorf(codes.InvalidArgument,
				"clips[%d]: trim range [%v, %v) is empty", i, inSec, outSec)
		}
		meta.Yuv = src.yuv
		meta.HasAudio = src.hasAudio
		if hasOut {
			meta.DurationSec = outSec - inSec
			meta.HasDuration = true
			meta.Trim = &concat.ClipTrim{InSec: inSec, OutSec: outSec}
		} else {
			meta.HasDuration = false
			meta.Trim = nil
		}
		clipMetas[i] = meta
	}

	dims := concat.ResolveTargetDims(req.GetTargetAspect(), firstDims)
	outFile := filepath.Join(dir, "final.mp4")

	// 4. 只执行调用方明确选择的拼接策略：xfade 必须完整可执行，hard_cut 不重叠时间轴。
	singlePass := concat.BuildSinglePassConcatArgs(concat.SinglePassInput{
		Clips:        clipMetas,
		Files:        rawFiles,
		Dims:         dims,
		XfadeSeconds: xfadeSeconds,
		ColorMatch:   colorMatch,
		OutFile:      outFile,
	})
	if xfadeSeconds > 0 {
		if singlePass == nil {
			return nil, status.Error(codes.FailedPrecondition,
				"video_concat_explicit_xfade_unexecutable")
		}
		if err := s.runner.Run(ctx, singlePass...); err != nil {
			return nil, status.Errorf(codes.Internal, "concat single-pass: %v", err)
		}
	} else {
		if err := s.concatHardCut(ctx, clips, clipMetas, rawFiles, dims, colorMatch, dir, outFile); err != nil {
			return nil, err
		}
	}

	stat, err := os.Stat(outFile)
	if err != nil || stat.Size() == 0 {
		return nil, status.Error(codes.Internal, "concat output is empty")
	}
	if err := store.UploadFile(ctx, outputKey, outFile, "video/mp4", immutableCache); err != nil {
		return nil, status.Errorf(codes.Internal, "upload concat output: %v", err)
	}
	joinMode := "hard_cut"
	if xfadeSeconds > 0 {
		joinMode = "xfade"
	}
	log.Printf(
		"[media-worker] concat done key=%s clips=%d bytes=%d join_mode=%s xfade_seconds=%.3f color_match=%t",
		outputKey,
		len(clips),
		stat.Size(),
		joinMode,
		xfadeSeconds,
		colorMatch,
	)
	return &tapmediav1.ConcatVideosResponse{
		Key:       outputKey,
		Url:       store.PublicURL(outputKey),
		Bytes:     stat.Size(),
		ClipCount: int32(len(clips)),
	}, nil
}

// concatHardCut 显式硬切：逐段 normalize（可选色彩校正折进同一遍编码）→ concat demuxer 流拷贝。
func (s *MediaServer) concatHardCut(
	ctx context.Context,
	clips []*tapmediav1.ConcatClip,
	clipMetas []concat.ClipMeta,
	rawFiles []string,
	dims concat.Dims,
	colorMatch bool,
	dir, outFile string,
) error {
	var corrections []*concat.ColorCorrection
	if colorMatch {
		stats := make([]*concat.YuvStats, len(clipMetas))
		for i, m := range clipMetas {
			stats[i] = m.Yuv
		}
		corrections = concat.BuildColorCorrections(stats)
	}
	var normalized []string
	for i := range rawFiles {
		norm := filepath.Join(dir, fmt.Sprintf("norm-%d.mp4", i))
		colorFilter := ""
		if corrections != nil {
			colorFilter = concat.ColorFilterOf(corrections[i])
		}
		// trim 透传：有完整区间用之；只有 inSec（源时长未知）也照切，outSec 缺省=到结尾。
		var trimIn float64
		hasTrim := false
		var trimOut float64
		hasTrimOut := false
		if m := clipMetas[i]; m.Trim != nil {
			trimIn, trimOut, hasTrim, hasTrimOut = m.Trim.InSec, m.Trim.OutSec, true, true
		} else if clips[i].InSec != nil || clips[i].OutSec != nil {
			hasTrim = true
			if clips[i].InSec != nil && *clips[i].InSec > 0 {
				trimIn = *clips[i].InSec
			}
			if clips[i].OutSec != nil {
				trimOut = *clips[i].OutSec
				hasTrimOut = true
			}
		}

		vf := concat.NormalizeVF(dims, colorFilter)
		args := []string{"-y"}
		if hasTrim && trimIn > 0 {
			args = append(args, "-ss", concat.Fixed(trimIn, 3))
		}
		hasAudio := clipMetas[i].HasAudio
		if hasAudio {
			args = append(args, "-i", rawFiles[i])
		} else {
			args = append(args, "-i", rawFiles[i],
				"-f", "lavfi",
				"-i", fmt.Sprintf("anullsrc=channel_layout=stereo:sample_rate=%d", concat.TargetAR))
		}
		if hasTrimOut && trimOut > trimIn {
			args = append(args, "-t", concat.Fixed(trimOut-trimIn, 3))
		}
		args = append(args,
			"-vf", vf,
			"-c:v", "libx264",
			"-preset", "medium",
			"-pix_fmt", "yuv420p",
			"-c:a", "aac",
			"-ar", fmt.Sprintf("%d", concat.TargetAR),
			"-ac", "2",
		)
		if hasAudio {
			args = append(args, "-map", "0:v:0", "-map", "0:a:0")
		} else {
			args = append(args, "-map", "0:v:0", "-map", "1:a:0", "-shortest")
		}
		args = append(args, norm)
		if err := s.runner.Run(ctx, args...); err != nil {
			return status.Errorf(codes.Internal, "normalize clip %d: %v", i, err)
		}
		normalized = append(normalized, norm)
	}
	var listLines []string
	for _, p := range normalized {
		listLines = append(listLines, fmt.Sprintf("file '%s'", strings.ReplaceAll(p, "'", "'\\''")))
	}
	listFile := filepath.Join(dir, "list.txt")
	if err := os.WriteFile(listFile, []byte(strings.Join(listLines, "\n")), 0o644); err != nil {
		return status.Errorf(codes.Internal, "write concat list: %v", err)
	}
	if err := s.runner.Run(ctx,
		"-y",
		"-f", "concat",
		"-safe", "0",
		"-i", listFile,
		"-c", "copy",
		"-movflags", "+faststart",
		outFile,
	); err != nil {
		return status.Errorf(codes.Internal, "concat demuxer: %v", err)
	}
	return nil
}

// ── MuxAudio ─────────────────────────────────────────────────────────────

func clampVolume(v *float64, fallback, max float64) float64 {
	if v == nil {
		return fallback
	}
	n := *v
	if n < 0 {
		return 0
	}
	if n > max {
		return max
	}
	return n
}

func (s *MediaServer) MuxAudio(ctx context.Context, req *tapmediav1.MuxAudioRequest) (*tapmediav1.MuxAudioResponse, error) {
	store, err := s.requireStore()
	if err != nil {
		return nil, err
	}
	videoURL := strings.TrimSpace(req.GetVideoUrl())
	audioURL := strings.TrimSpace(req.GetAudioUrl())
	userID := strings.TrimSpace(req.GetUserId())
	if videoURL == "" || audioURL == "" {
		return nil, status.Error(codes.InvalidArgument, "video_url and audio_url are required")
	}
	if userID == "" {
		return nil, status.Error(codes.InvalidArgument, "user_id is required")
	}
	originalVolume := clampVolume(req.OriginalVolume, 0.3, 1)
	audioVolume := clampVolume(req.AudioVolume, 1, 2)

	release, err := s.acquireJobSlot(ctx)
	if err != nil {
		return nil, err
	}
	defer release()

	dir, err := os.MkdirTemp("", "tapmedia-mux-")
	if err != nil {
		return nil, status.Errorf(codes.Internal, "mkdtemp: %v", err)
	}
	defer os.RemoveAll(dir)

	videoFile := filepath.Join(dir, "video.mp4")
	audioFile := filepath.Join(dir, "audio.mp3")
	if err := store.SmartDownloadToFile(ctx, videoURL, videoFile); err != nil {
		return nil, status.Errorf(codes.Internal, "download video: %v", err)
	}
	if err := store.SmartDownloadToFile(ctx, audioURL, audioFile); err != nil {
		return nil, status.Errorf(codes.Internal, "download audio: %v", err)
	}

	videoHasAudio := s.runner.HasAudioStream(ctx, videoFile)
	mode := "replace"
	if req.GetMode() == "mix" && videoHasAudio {
		mode = "mix"
	}

	outFile := filepath.Join(dir, "muxed.mp4")
	args := []string{"-y", "-i", videoFile, "-i", audioFile}
	if mode == "mix" {
		args = append(args,
			"-filter_complex",
			fmt.Sprintf("[0:a]volume=%s[orig];[1:a]volume=%s,apad[voice];[orig][voice]amix=inputs=2:duration=first:normalize=0[aout]",
				jsNum(originalVolume), jsNum(audioVolume)),
			"-map", "0:v:0",
			"-map", "[aout]",
		)
	} else {
		args = append(args,
			"-filter_complex",
			fmt.Sprintf("[1:a]volume=%s,apad[aout]", jsNum(audioVolume)),
			"-map", "0:v:0",
			"-map", "[aout]",
			"-shortest",
		)
	}
	args = append(args,
		"-c:v", "copy",
		"-c:a", "aac",
		"-ar", fmt.Sprintf("%d", concat.TargetAR),
		"-ac", "2",
		"-movflags", "+faststart",
		outFile,
	)
	if err := s.runner.Run(ctx, args...); err != nil {
		return nil, status.Errorf(codes.Internal, "mux: %v", err)
	}

	stat, err := os.Stat(outFile)
	if err != nil || stat.Size() == 0 {
		return nil, status.Error(codes.Internal, "mux output is empty")
	}
	key := fmt.Sprintf("gen/videos/%s/%s/%s.mp4", safeUserSegment(userID), datePrefix(time.Now()), uuid.NewString())
	if err := store.UploadFile(ctx, key, outFile, "video/mp4", immutableCache); err != nil {
		return nil, status.Errorf(codes.Internal, "upload mux output: %v", err)
	}
	resp := &tapmediav1.MuxAudioResponse{
		Key:   key,
		Url:   store.PublicURL(key),
		Bytes: stat.Size(),
	}
	if d, ok := s.runner.ProbeDurationSeconds(ctx, outFile); ok {
		resp.DurationSeconds = &d
	}
	log.Printf("[media-worker] mux done key=%s mode=%s bytes=%d", key, mode, stat.Size())
	return resp, nil
}

// ── ExtractLastFrame / ExtractFramesAt ───────────────────────────────────

func (s *MediaServer) ExtractLastFrame(ctx context.Context, req *tapmediav1.ExtractLastFrameRequest) (*tapmediav1.ExtractLastFrameResponse, error) {
	store, err := s.requireStore()
	if err != nil {
		return nil, err
	}
	release, err := s.acquireJobSlot(ctx)
	if err != nil {
		return nil, err
	}
	defer release()

	dir, err := os.MkdirTemp("", "tapmedia-lastframe-")
	if err != nil {
		return nil, status.Errorf(codes.Internal, "mkdtemp: %v", err)
	}
	defer os.RemoveAll(dir)

	videoPath, err := s.fetchSource(ctx, req.GetVideo(), dir)
	if err != nil {
		return nil, err
	}
	outFile := filepath.Join(dir, "last.png")
	if err := s.runner.ExtractLastFrame(ctx, videoPath, outFile); err != nil {
		return nil, status.Errorf(codes.Internal, "extract last frame: %v", err)
	}
	key := fmt.Sprintf("gen/images/lastframe/%s/%s.png", datePrefix(time.Now()), uuid.NewString())
	if err := store.UploadFile(ctx, key, outFile, "image/png", immutableCache); err != nil {
		return nil, status.Errorf(codes.Internal, "upload frame: %v", err)
	}
	return &tapmediav1.ExtractLastFrameResponse{FrameKey: key, FrameUrl: store.PublicURL(key)}, nil
}

func (s *MediaServer) ExtractFramesAt(ctx context.Context, req *tapmediav1.ExtractFramesAtRequest) (*tapmediav1.ExtractFramesAtResponse, error) {
	store, err := s.requireStore()
	if err != nil {
		return nil, err
	}
	times := req.GetTimesSec()
	if len(times) == 0 {
		return nil, status.Error(codes.InvalidArgument, "times_sec must contain at least 1 timestamp")
	}
	for _, t := range times {
		if t < 0 {
			return nil, status.Error(codes.InvalidArgument, "times_sec entries must be non-negative")
		}
	}

	release, err := s.acquireJobSlot(ctx)
	if err != nil {
		return nil, err
	}
	defer release()

	dir, err := os.MkdirTemp("", "tapmedia-framesat-")
	if err != nil {
		return nil, status.Errorf(codes.Internal, "mkdtemp: %v", err)
	}
	defer os.RemoveAll(dir)

	videoPath, err := s.fetchSource(ctx, req.GetVideo(), dir)
	if err != nil {
		return nil, err
	}
	var width, height int
	if w, h, ok := s.runner.ProbeDims(ctx, videoPath); ok {
		width, height = w, h
	}

	date := datePrefix(time.Now())
	var frames []*tapmediav1.FrameAt
	for idx, t := range times {
		outFile := filepath.Join(dir, fmt.Sprintf("frame_%d.webp", idx))
		if err := s.runner.ExtractFrameWebpAt(ctx, videoPath, t, outFile); err != nil {
			return nil, status.Errorf(codes.Internal, "extract frame @%v: %v", t, err)
		}
		key := fmt.Sprintf("gen/images/framesat/%s/%s_t%d.webp", date, uuid.NewString(), idx)
		if err := store.UploadFile(ctx, key, outFile, "image/webp", immutableCache); err != nil {
			return nil, status.Errorf(codes.Internal, "upload frame @%v: %v", t, err)
		}
		frames = append(frames, &tapmediav1.FrameAt{
			TimeSec: t,
			Key:     key,
			Url:     store.PublicURL(key),
			Width:   int32(width),
			Height:  int32(height),
		})
	}
	return &tapmediav1.ExtractFramesAtResponse{Frames: frames}, nil
}

// ── SplitVideo / TranscodeProxy ──────────────────────────────────────────

func (s *MediaServer) SplitVideo(ctx context.Context, req *tapmediav1.SplitVideoRequest) (*tapmediav1.SplitVideoResponse, error) {
	store, err := s.requireStore()
	if err != nil {
		return nil, err
	}
	segments := req.GetSegments()
	if len(segments) == 0 {
		return nil, status.Error(codes.InvalidArgument, "segments must not be empty")
	}

	release, err := s.acquireJobSlot(ctx)
	if err != nil {
		return nil, err
	}
	defer release()

	dir, err := os.MkdirTemp("", "tapmedia-split-")
	if err != nil {
		return nil, status.Errorf(codes.Internal, "mkdtemp: %v", err)
	}
	defer os.RemoveAll(dir)

	videoPath, err := s.fetchSource(ctx, req.GetVideo(), dir)
	if err != nil {
		return nil, err
	}
	date := datePrefix(time.Now())
	var out []*tapmediav1.SplitSegment
	for _, seg := range segments {
		segFile := filepath.Join(dir, fmt.Sprintf("seg%d.mp4", seg.GetIndex()))
		durSec := seg.GetEndSec() - seg.GetStartSec()
		if durSec < 0.1 {
			durSec = 0.1
		}
		if err := s.runner.CopySegment(ctx, videoPath, seg.GetStartSec(), durSec, segFile); err != nil {
			return nil, status.Errorf(codes.Internal, "split segment %d: %v", seg.GetIndex(), err)
		}
		key := fmt.Sprintf("gen/videos/segments/%s/%s_s%d.mp4", date, uuid.NewString(), seg.GetIndex())
		if err := store.UploadFile(ctx, key, segFile, "video/mp4", immutableCache); err != nil {
			return nil, status.Errorf(codes.Internal, "upload segment %d: %v", seg.GetIndex(), err)
		}
		out = append(out, &tapmediav1.SplitSegment{
			Index:    seg.GetIndex(),
			StartSec: seg.GetStartSec(),
			EndSec:   seg.GetEndSec(),
			Key:      key,
			Url:      store.PublicURL(key),
		})
	}
	return &tapmediav1.SplitVideoResponse{Segments: out}, nil
}

func (s *MediaServer) TranscodeProxy(ctx context.Context, req *tapmediav1.TranscodeProxyRequest) (*tapmediav1.TranscodeProxyResponse, error) {
	store, err := s.requireStore()
	if err != nil {
		return nil, err
	}
	release, err := s.acquireJobSlot(ctx)
	if err != nil {
		return nil, err
	}
	defer release()

	dir, err := os.MkdirTemp("", "tapmedia-proxy-")
	if err != nil {
		return nil, status.Errorf(codes.Internal, "mkdtemp: %v", err)
	}
	defer os.RemoveAll(dir)

	videoPath, err := s.fetchSource(ctx, req.GetVideo(), dir)
	if err != nil {
		return nil, err
	}
	outFile := filepath.Join(dir, "proxy.mp4")
	if err := s.runner.TranscodeUnderstandingProxy(ctx, videoPath, outFile); err != nil {
		return nil, status.Errorf(codes.Internal, "transcode proxy: %v", err)
	}
	stat, err := os.Stat(outFile)
	if err != nil || stat.Size() == 0 {
		return nil, status.Error(codes.Internal, "proxy output is empty")
	}
	key := fmt.Sprintf("gen/videos/proxies/%s/%s_proxy.mp4", datePrefix(time.Now()), uuid.NewString())
	if err := store.UploadFile(ctx, key, outFile, "video/mp4", immutableCache); err != nil {
		return nil, status.Errorf(codes.Internal, "upload proxy: %v", err)
	}
	return &tapmediav1.TranscodeProxyResponse{
		Key:       key,
		Url:       store.PublicURL(key),
		SizeBytes: stat.Size(),
	}, nil
}
