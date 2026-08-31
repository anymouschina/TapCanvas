package server

import (
	"context"
	"fmt"
	"log"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/google/uuid"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"

	tapmediav1 "tapcanvas/media-worker/gen/tapmedia/v1"
	"tapcanvas/media-worker/internal/config"
	"tapcanvas/media-worker/internal/ffmpeg"
	"tapcanvas/media-worker/internal/storage"
)

const defaultPosterMaxEdge = 640

type MediaServer struct {
	tapmediav1.UnimplementedMediaServiceServer

	cfg     config.Config
	store   *storage.Client
	runner  *ffmpeg.Runner
	// 有界准入：ffmpeg 是内存/CPU 大户，超过并发上限直接 RESOURCE_EXHAUSTED，
	// 让上游（有本地 fallback）自行降级，而不是在 worker 里排队堆内存。
	jobSlots chan struct{}
}

func New(cfg config.Config) (*MediaServer, error) {
	s := &MediaServer{
		cfg:      cfg,
		runner:   &ffmpeg.Runner{Timeout: cfg.FFmpegTimeout},
		jobSlots: make(chan struct{}, cfg.MaxFFmpegJobs),
	}
	if cfg.Storage != nil {
		store, err := storage.New(cfg.Storage)
		if err != nil {
			return nil, err
		}
		s.store = store
	}
	return s, nil
}

func (s *MediaServer) acquireJobSlot(ctx context.Context) (release func(), err error) {
	select {
	case s.jobSlots <- struct{}{}:
		return func() { <-s.jobSlots }, nil
	case <-ctx.Done():
		return nil, status.Error(codes.DeadlineExceeded, "canceled while waiting for ffmpeg slot")
	default:
		return nil, status.Errorf(codes.ResourceExhausted,
			"ffmpeg concurrency limit reached (%d)", s.cfg.MaxFFmpegJobs)
	}
}

func (s *MediaServer) requireStore() (*storage.Client, error) {
	if s.store == nil {
		return nil, status.Error(codes.FailedPrecondition, "object storage env is not configured")
	}
	return s.store, nil
}

// fetchSource 把 MediaSource 落到本地临时文件，返回路径。调用方负责清理 dir。
func (s *MediaServer) fetchSource(ctx context.Context, src *tapmediav1.MediaSource, dir string) (string, error) {
	if src == nil {
		return "", status.Error(codes.InvalidArgument, "source is required")
	}
	dest := filepath.Join(dir, "source-"+uuid.NewString())
	switch v := src.Src.(type) {
	case *tapmediav1.MediaSource_R2Key:
		store, err := s.requireStore()
		if err != nil {
			return "", err
		}
		if strings.TrimSpace(v.R2Key) == "" {
			return "", status.Error(codes.InvalidArgument, "r2_key is empty")
		}
		if err := store.DownloadKeyToFile(ctx, v.R2Key, dest); err != nil {
			if strings.Contains(err.Error(), "NoSuchKey") || strings.Contains(err.Error(), "NotFound") {
				return "", status.Errorf(codes.NotFound, "object not found: %s", v.R2Key)
			}
			return "", status.Errorf(codes.Internal, "download %s: %v", v.R2Key, err)
		}
	case *tapmediav1.MediaSource_Url:
		if strings.TrimSpace(v.Url) == "" {
			return "", status.Error(codes.InvalidArgument, "url is empty")
		}
		if s.store == nil {
			return "", status.Error(codes.FailedPrecondition, "object storage env is not configured")
		}
		// 命中自有存储 publicBase 前缀自动改走 S3 GetObject（出网受限环境的唯一可靠路径）。
		if err := s.store.SmartDownloadToFile(ctx, v.Url, dest); err != nil {
			return "", status.Errorf(codes.Internal, "download url: %v", err)
		}
	default:
		return "", status.Error(codes.InvalidArgument, "source.src must be r2_key or url")
	}
	return dest, nil
}

func (s *MediaServer) Health(ctx context.Context, _ *tapmediav1.HealthRequest) (*tapmediav1.HealthResponse, error) {
	version, err := s.runner.Version(ctx)
	if err != nil {
		return &tapmediav1.HealthResponse{Ok: false}, nil
	}
	bucket := ""
	if s.cfg.Storage != nil {
		bucket = s.cfg.Storage.Bucket
	}
	return &tapmediav1.HealthResponse{Ok: true, FfmpegVersion: version, StorageBucket: bucket}, nil
}

func (s *MediaServer) ProbeMedia(ctx context.Context, req *tapmediav1.ProbeMediaRequest) (*tapmediav1.ProbeMediaResponse, error) {
	release, err := s.acquireJobSlot(ctx)
	if err != nil {
		return nil, err
	}
	defer release()

	dir, err := os.MkdirTemp("", "tapmedia-probe-")
	if err != nil {
		return nil, status.Errorf(codes.Internal, "mkdtemp: %v", err)
	}
	defer os.RemoveAll(dir)

	path, err := s.fetchSource(ctx, req.GetSource(), dir)
	if err != nil {
		return nil, err
	}
	probe, err := s.runner.Probe(ctx, path)
	if err != nil {
		return nil, status.Errorf(codes.Internal, "probe: %v", err)
	}
	return &tapmediav1.ProbeMediaResponse{
		DurationSeconds: probe.DurationSeconds,
		Width:           probe.Width,
		Height:          probe.Height,
		VideoCodec:      probe.VideoCodec,
		AudioCodec:      probe.AudioCodec,
		Fps:             probe.FPS,
		SizeBytes:       probe.SizeBytes,
	}, nil
}

// PosterKey 与 asset.video-poster.ts 的 key 布局一致：
// gen/thumbnails/<encodeURIComponent(userId)>/<yyyymmdd>/<uuid>.jpg
func PosterKey(userID string, now time.Time) string {
	datePrefix := now.UTC().Format("20060102")
	return fmt.Sprintf("gen/thumbnails/%s/%s/%s.jpg", url.PathEscape(userID), datePrefix, uuid.NewString())
}

func (s *MediaServer) ExtractPoster(ctx context.Context, req *tapmediav1.ExtractPosterRequest) (*tapmediav1.ExtractPosterResponse, error) {
	store, err := s.requireStore()
	if err != nil {
		return nil, err
	}
	userID := strings.TrimSpace(req.GetUserId())
	if userID == "" {
		return nil, status.Error(codes.InvalidArgument, "user_id is required")
	}
	maxEdge := int(req.GetMaxEdge())
	if maxEdge <= 0 {
		maxEdge = defaultPosterMaxEdge
	}

	release, err := s.acquireJobSlot(ctx)
	if err != nil {
		return nil, err
	}
	defer release()

	dir, err := os.MkdirTemp("", "tapmedia-poster-")
	if err != nil {
		return nil, status.Errorf(codes.Internal, "mkdtemp: %v", err)
	}
	defer os.RemoveAll(dir)

	videoPath, err := s.fetchSource(ctx, req.GetVideo(), dir)
	if err != nil {
		return nil, err
	}

	outPath := filepath.Join(dir, "poster.jpg")
	if err := s.runner.ExtractPoster(ctx, videoPath, outPath, maxEdge); err != nil {
		return nil, status.Errorf(codes.Internal, "extract poster: %v", err)
	}
	if stat, err := os.Stat(outPath); err != nil || stat.Size() == 0 {
		return nil, status.Error(codes.Internal, "poster output is empty")
	}

	key := PosterKey(userID, time.Now())
	if err := store.UploadFile(ctx, key, outPath, "image/jpeg", "public, max-age=31536000, immutable"); err != nil {
		return nil, status.Errorf(codes.Internal, "upload poster: %v", err)
	}
	log.Printf("[media-worker] poster extracted key=%s user=%s", key, userID)
	return &tapmediav1.ExtractPosterResponse{
		PosterKey: key,
		PosterUrl: store.PublicURL(key),
	}, nil
}
