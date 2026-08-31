// 当前选中的 S3 数据面：下载源媒体到本地临时文件、上传产物。
// 媒体字节永远不过 gRPC——这是 media-worker 保持无状态可横扩的前提。
package storage

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	awsconfig "github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/credentials"
	"github.com/aws/aws-sdk-go-v2/service/s3"
	"github.com/aws/aws-sdk-go-v2/service/s3/types"
	"github.com/aws/smithy-go"
	smithyhttp "github.com/aws/smithy-go/transport/http"

	"tapcanvas/media-worker/internal/config"
)

type Client struct {
	s3    *s3.Client
	cfg   *config.Storage
	httpc *http.Client
}

func New(cfg *config.Storage) (*Client, error) {
	if cfg == nil {
		return nil, fmt.Errorf("object storage env is not configured")
	}
	awsCfg, err := awsconfig.LoadDefaultConfig(context.Background(),
		awsconfig.WithRegion(cfg.Region),
		awsconfig.WithCredentialsProvider(
			credentials.NewStaticCredentialsProvider(cfg.AccessKeyID, cfg.SecretAccessKey, cfg.SessionToken),
		),
	)
	if err != nil {
		return nil, fmt.Errorf("load aws config: %w", err)
	}
	client := s3.NewFromConfig(awsCfg, func(o *s3.Options) {
		o.BaseEndpoint = aws.String(cfg.Endpoint)
		o.UsePathStyle = cfg.ForcePathStyle
	})
	return &Client{
		s3:  client,
		cfg: cfg,
		// 第三方 URL 下载用；第一方对象走所选 provider 的 S3 GetObject。
		httpc: &http.Client{Timeout: 10 * time.Minute},
	}, nil
}

func (c *Client) Bucket() string { return c.cfg.Bucket }

func (c *Client) PublicURL(key string) string { return c.cfg.PublicURL(key) }

func objectNotFound(err error) bool {
	var notFound *types.NotFound
	if errors.As(err, &notFound) {
		return true
	}
	var apiError smithy.APIError
	if errors.As(err, &apiError) && (apiError.ErrorCode() == "NotFound" || apiError.ErrorCode() == "NoSuchKey") {
		return true
	}
	var responseError *smithyhttp.ResponseError
	return errors.As(err, &responseError) && responseError.HTTPStatusCode() == http.StatusNotFound
}

// ObjectSize returns the persisted byte size for an exact object key. A missing
// object is a normal cache miss; every other storage error remains explicit.
func (c *Client) ObjectSize(ctx context.Context, key string) (int64, bool, error) {
	out, err := c.s3.HeadObject(ctx, &s3.HeadObjectInput{
		Bucket: aws.String(c.cfg.Bucket),
		Key:    aws.String(key),
	})
	if err != nil {
		if objectNotFound(err) {
			return 0, false, nil
		}
		return 0, false, fmt.Errorf("s3 HeadObject %s: %w", key, err)
	}
	return aws.ToInt64(out.ContentLength), true, nil
}

// withDownloadRetry 大文件流式下载偶发中途断流(unexpected EOF)；GET 幂等，
// 重试 2 次带短退避（每次重下完整文件，writeStreamToFile 失败会清掉半成品）。
func withDownloadRetry(ctx context.Context, label string, fn func() error) error {
	var lastErr error
	for attempt := 0; attempt < 3; attempt++ {
		if attempt > 0 {
			select {
			case <-ctx.Done():
				return ctx.Err()
			case <-time.After(time.Duration(attempt) * 2 * time.Second):
			}
		}
		if lastErr = fn(); lastErr == nil {
			return nil
		}
		// 对象不存在类错误不重试（重试也不会出现）。
		if strings.Contains(lastErr.Error(), "NoSuchKey") || strings.Contains(lastErr.Error(), "status 404") {
			return lastErr
		}
	}
	return fmt.Errorf("%s failed after retries: %w", label, lastErr)
}

// DownloadKeyToFile 流式落盘，不进堆。
func (c *Client) DownloadKeyToFile(ctx context.Context, key, destPath string) error {
	return withDownloadRetry(ctx, "s3 GetObject "+key, func() error {
		out, err := c.s3.GetObject(ctx, &s3.GetObjectInput{
			Bucket: aws.String(c.cfg.Bucket),
			Key:    aws.String(key),
		})
		if err != nil {
			return fmt.Errorf("s3 GetObject %s: %w", key, err)
		}
		defer out.Body.Close()
		return writeStreamToFile(out.Body, destPath)
	})
}

// SmartDownloadToFile 对齐 hono-api downloadTo/streamDownloadToFile：URL 命中自有存储
// publicBase 前缀时改走 S3 GetObject（出网受限环境 CDN 域可能被限流而 S3 端点可达），
// 否则普通 HTTP 拉取。
func (c *Client) SmartDownloadToFile(ctx context.Context, rawURL, destPath string) error {
	publicBase := strings.TrimRight(strings.TrimSpace(c.cfg.PublicBase), "/")
	if publicBase != "" && strings.HasPrefix(rawURL, publicBase+"/") {
		key := strings.TrimPrefix(rawURL, publicBase+"/")
		if i := strings.IndexAny(key, "?#"); i >= 0 {
			key = key[:i]
		}
		return c.DownloadKeyToFile(ctx, key, destPath)
	}
	return c.DownloadURLToFile(ctx, rawURL, destPath)
}

func (c *Client) DownloadURLToFile(ctx context.Context, rawURL, destPath string) error {
	return withDownloadRetry(ctx, "fetch "+rawURL, func() error {
		req, err := http.NewRequestWithContext(ctx, http.MethodGet, rawURL, nil)
		if err != nil {
			return err
		}
		resp, err := c.httpc.Do(req)
		if err != nil {
			return fmt.Errorf("fetch %s: %w", rawURL, err)
		}
		defer resp.Body.Close()
		if resp.StatusCode != http.StatusOK {
			return fmt.Errorf("fetch %s: status %d", rawURL, resp.StatusCode)
		}
		return writeStreamToFile(resp.Body, destPath)
	})
}

func writeStreamToFile(r io.Reader, destPath string) error {
	f, err := os.Create(destPath)
	if err != nil {
		return err
	}
	defer f.Close()
	if _, err := io.Copy(f, r); err != nil {
		os.Remove(destPath)
		return err
	}
	return f.Sync()
}

func (c *Client) UploadFile(ctx context.Context, key, filePath, contentType, cacheControl string) error {
	f, err := os.Open(filePath)
	if err != nil {
		return err
	}
	defer f.Close()
	stat, err := f.Stat()
	if err != nil {
		return err
	}
	_, err = c.s3.PutObject(ctx, &s3.PutObjectInput{
		Bucket:        aws.String(c.cfg.Bucket),
		Key:           aws.String(key),
		Body:          f,
		ContentType:   aws.String(contentType),
		CacheControl:  aws.String(cacheControl),
		ContentLength: aws.Int64(stat.Size()),
	})
	if err != nil {
		return fmt.Errorf("s3 PutObject %s: %w", key, err)
	}
	return nil
}
