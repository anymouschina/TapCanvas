// 对象存储配置解析。字段与 hono-api 的显式 provider 契约一致，
// 避免媒体产物和 API 资产写入不同 bucket。
package config

import (
	"fmt"
	"net/url"
	"os"
	"sort"
	"strconv"
	"strings"
	"time"
)

type Storage struct {
	Provider        string // "tos" or "r2"
	AccessKeyID     string
	SecretAccessKey string
	SessionToken    string
	Endpoint        string
	Region          string
	Bucket          string
	PublicBase      string
	ForcePathStyle  bool
}

type Config struct {
	Port          int
	MaxFFmpegJobs int
	FFmpegTimeout time.Duration
	Storage       *Storage
}

var providerStorageKeys = map[string][]string{
	"tos": {
		"TOS_ACCESS_KEY_ID",
		"TOS_SECRET_ACCESS_KEY",
		"TOS_ENDPOINT_URL",
		"TOS_REGION",
		"TOS_BUCKET",
		"TOS_PUBLIC_BASE_URL",
	},
	"r2": {
		"R2_ACCESS_KEY_ID",
		"R2_SECRET_ACCESS_KEY",
		"R2_ENDPOINT_URL",
		"R2_REGION",
		"R2_BUCKET",
		"R2_PUBLIC_BASE_URL",
	},
}

// ResolveStorage 返回 nil 表示对象存储完全未配置。任意存储字段存在时，
// 必须用 OBJECT_STORAGE_PROVIDER 显式选择唯一数据面；不做自动跨 provider 回退。
func ResolveStorage() *Storage {
	provider := strings.ToLower(strings.TrimSpace(os.Getenv("OBJECT_STORAGE_PROVIDER")))
	hasStorageConfig := false
	presentKeys := []string{}
	for _, keys := range providerStorageKeys {
		for _, key := range keys {
			if strings.TrimSpace(os.Getenv(key)) != "" {
				hasStorageConfig = true
				presentKeys = append(presentKeys, key)
			}
		}
	}
	sort.Strings(presentKeys)
	if provider == "" && !hasStorageConfig {
		return nil
	}
	if provider == "" {
		// Name the keys that triggered this. Without them the operator only sees
		// "provider is required" and cannot tell which half-configured provider
		// caused it — the process then crash-loops on the same opaque line.
		panic(fmt.Sprintf(
			"OBJECT_STORAGE_PROVIDER is required when object storage is configured: found %s. "+
				"Set OBJECT_STORAGE_PROVIDER=tos or =r2 to select one data plane, "+
				"or unset those keys to run without object storage",
			strings.Join(presentKeys, ", "),
		))
	}
	keys, supported := providerStorageKeys[provider]
	if !supported {
		panic("OBJECT_STORAGE_PROVIDER must be either tos or r2")
	}

	missing := []string{}
	values := make(map[string]string, len(keys))
	for _, key := range keys {
		value := strings.TrimSpace(os.Getenv(key))
		values[key] = value
		if value == "" {
			missing = append(missing, key)
		}
	}
	if len(missing) > 0 {
		panic(fmt.Sprintf("%s object storage env is incomplete: missing %s", strings.ToUpper(provider), strings.Join(missing, ", ")))
	}

	prefix := strings.ToUpper(provider)
	endpoint := strings.TrimRight(values[prefix+"_ENDPOINT_URL"], "/")
	endpointURL, err := url.Parse(endpoint)
	if err != nil || endpointURL.Scheme != "https" || endpointURL.Hostname() == "" {
		panic(fmt.Sprintf("%s_ENDPOINT_URL must be an absolute https URL", prefix))
	}
	if provider == "tos" && !strings.HasPrefix(endpointURL.Hostname(), "tos-s3-") {
		panic("TOS_ENDPOINT_URL must be an https TOS S3-compatible endpoint (tos-s3-...)")
	}
	if provider == "r2" && !strings.HasSuffix(endpointURL.Hostname(), ".r2.cloudflarestorage.com") {
		panic("R2_ENDPOINT_URL must use a Cloudflare R2 S3 endpoint (*.r2.cloudflarestorage.com)")
	}
	if provider == "r2" && values["R2_REGION"] != "auto" {
		panic("R2_REGION must be auto")
	}
	publicBase := strings.TrimRight(values[prefix+"_PUBLIC_BASE_URL"], "/")
	publicURL, err := url.Parse(publicBase)
	if err != nil || publicURL.Scheme != "https" || publicURL.Hostname() == "" {
		panic(fmt.Sprintf("%s_PUBLIC_BASE_URL must be an absolute https URL", prefix))
	}

	return &Storage{
		Provider:        provider,
		AccessKeyID:     values[prefix+"_ACCESS_KEY_ID"],
		SecretAccessKey: values[prefix+"_SECRET_ACCESS_KEY"],
		SessionToken:    strings.TrimSpace(os.Getenv(prefix + "_SESSION_TOKEN")),
		Endpoint:        endpoint,
		Region:          values[prefix+"_REGION"],
		Bucket:          values[prefix+"_BUCKET"],
		PublicBase:      publicBase,
		ForcePathStyle:  false,
	}
}

func envInt(key string, fallback int) int {
	raw := strings.TrimSpace(os.Getenv(key))
	if raw == "" {
		return fallback
	}
	n, err := strconv.Atoi(raw)
	if err != nil || n <= 0 {
		return fallback
	}
	return n
}

func Load() Config {
	// FFMPEG_SUBPROCESS_TIMEOUT_MS 与 hono-api subprocess-limits.ts 同名同默认（15min）。
	timeoutMs := envInt("FFMPEG_SUBPROCESS_TIMEOUT_MS", 15*60*1000)
	return Config{
		Port:          envInt("MEDIA_WORKER_PORT", 9090),
		MaxFFmpegJobs: envInt("MEDIA_WORKER_MAX_FFMPEG", 8),
		FFmpegTimeout: time.Duration(timeoutMs) * time.Millisecond,
		Storage:       ResolveStorage(),
	}
}

func (s *Storage) PublicURL(key string) string {
	if s == nil || s.PublicBase == "" {
		return "/" + key
	}
	return fmt.Sprintf("%s/%s", s.PublicBase, key)
}
