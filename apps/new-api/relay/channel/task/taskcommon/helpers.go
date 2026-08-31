package taskcommon

import (
	"encoding/base64"
	"fmt"
	"math"
	"strconv"
	"strings"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	"github.com/QuantumNous/new-api/setting/system_setting"
	"github.com/gin-gonic/gin"
)

// UnmarshalMetadata converts a map[string]any metadata to a typed struct via JSON round-trip.
// This replaces the repeated pattern: json.Marshal(metadata) → json.Unmarshal(bytes, &target).
func UnmarshalMetadata(metadata map[string]any, target any) error {
	if metadata == nil {
		return nil
	}
	// Prevent metadata from overriding model fields to avoid billing bypass.
	delete(metadata, "model")
	metaBytes, err := common.Marshal(metadata)
	if err != nil {
		return fmt.Errorf("marshal metadata failed: %w", err)
	}
	if err := common.Unmarshal(metaBytes, target); err != nil {
		return fmt.Errorf("unmarshal metadata failed: %w", err)
	}
	return nil
}

// DefaultString returns val if non-empty, otherwise fallback.
func DefaultString(val, fallback string) string {
	if val == "" {
		return fallback
	}
	return val
}

// DefaultInt returns val if non-zero, otherwise fallback.
func DefaultInt(val, fallback int) int {
	if val == 0 {
		return fallback
	}
	return val
}

// EncodeLocalTaskID encodes an upstream operation name to a URL-safe base64 string.
// Used by Gemini/Vertex to store upstream names as task IDs.
func EncodeLocalTaskID(name string) string {
	return base64.RawURLEncoding.EncodeToString([]byte(name))
}

// DecodeLocalTaskID decodes a base64-encoded upstream operation name.
func DecodeLocalTaskID(id string) (string, error) {
	b, err := base64.RawURLEncoding.DecodeString(id)
	if err != nil {
		return "", err
	}
	return string(b), nil
}

// BuildProxyURL constructs the video proxy URL using the public task ID.
// e.g., "https://your-server.com/v1/videos/task_xxxx/content"
func BuildProxyURL(taskID string) string {
	return fmt.Sprintf("%s/v1/videos/%s/content", system_setting.ServerAddress, taskID)
}

// ResolveTaskVideoSpec 解析任务请求中的视频规格：metadata 优先，其次顶层字段。
// 不做默认值兜底 —— 只有请求显式携带规格时才返回非空值，供按 (分辨率×时长)
// 规格价计费（model.VideoSpecPriceCNY）使用。
func ResolveTaskVideoSpec(req *relaycommon.TaskSubmitReq) (resolution string, duration int) {
	resolution = strings.TrimSpace(req.Resolution)
	duration = req.Duration
	if req.Metadata != nil {
		if v, ok := req.Metadata["resolution"].(string); ok && strings.TrimSpace(v) != "" {
			resolution = strings.TrimSpace(v)
		}
		switch v := req.Metadata["duration"].(type) {
		case float64:
			if v > 0 {
				duration = int(v)
			}
		case string:
			if n, err := strconv.Atoi(strings.TrimSpace(v)); err == nil && n > 0 {
				duration = n
			}
		}
	}
	if duration <= 0 {
		if sec, err := strconv.Atoi(strings.TrimSpace(req.Seconds)); err == nil && sec > 0 {
			duration = sec
		}
	}
	return resolution, duration
}

// ResolveTaskVideoBillingSpec keeps the requested output duration untouched for
// the upstream payload, while adding the authoritative reference-video duration
// only for pricing.
func ResolveTaskVideoBillingSpec(req *relaycommon.TaskSubmitReq) (resolution string, billableDuration int) {
	resolution, billableDuration = ResolveTaskVideoSpec(req)
	if req.Metadata == nil {
		return resolution, billableDuration
	}
	switch value := req.Metadata["billing_reference_video_duration_seconds"].(type) {
	case float64:
		if value > 0 {
			billableDuration += int(math.Ceil(value))
		}
	case int:
		if value > 0 {
			billableDuration += value
		}
	}
	return resolution, billableDuration
}

// Status-to-progress mapping constants for polling updates.
const (
	ProgressSubmitted  = "10%"
	ProgressQueued     = "20%"
	ProgressInProgress = "30%"
	ProgressComplete   = "100%"
)

// ---------------------------------------------------------------------------
// BaseBilling — embeddable no-op implementations for TaskAdaptor billing methods.
// Adaptors that do not need custom billing can embed this struct directly.
// ---------------------------------------------------------------------------

type BaseBilling struct{}

// EstimateBilling returns nil (no extra ratios; use base model price).
func (BaseBilling) EstimateBilling(_ *gin.Context, _ *relaycommon.RelayInfo) map[string]float64 {
	return nil
}

// AdjustBillingOnSubmit returns nil (no submit-time adjustment).
func (BaseBilling) AdjustBillingOnSubmit(_ *relaycommon.RelayInfo, _ []byte) map[string]float64 {
	return nil
}

// AdjustBillingOnComplete returns 0 (keep pre-charged amount).
func (BaseBilling) AdjustBillingOnComplete(_ *model.Task, _ *relaycommon.TaskInfo) int {
	return 0
}
