package model

import (
	"encoding/json"
	"errors"
	"fmt"
	"regexp"
	"strings"

	"github.com/QuantumNous/new-api/common"
	relaycommon "github.com/QuantumNous/new-api/relay/common"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

var traceBase64RE = regexp.MustCompile(`"([A-Za-z0-9+/\r\n]{500,}={0,2})"`)

func truncateTraceBase64(s string) string {
	return SanitizeLargeTextForLog(s)
}

func SanitizeLargeTextForLog(s string) string {
	if len(s) < 500 {
		return s
	}
	var payload any
	if err := json.Unmarshal([]byte(s), &payload); err == nil {
		if sanitized, changed := sanitizeLogValue(payload); changed {
			if encoded, marshalErr := json.Marshal(sanitized); marshalErr == nil {
				return string(encoded)
			}
		}
	}
	sanitized := traceBase64RE.ReplaceAllStringFunc(s, func(match string) string {
		inner := match[1 : len(match)-1]
		inner = strings.ReplaceAll(strings.ReplaceAll(inner, "\r", ""), "\n", "")
		return fmt.Sprintf(`"[base64 ~%d chars]"`, len(inner))
	})
	if sanitized != s {
		return sanitized
	}
	if sanitizedString, changed := sanitizeLongLogString(s); changed {
		return sanitizedString
	}
	return s
}

func sanitizeLogValue(value any) (any, bool) {
	switch typed := value.(type) {
	case map[string]any:
		changed := false
		sanitized := make(map[string]any, len(typed))
		for key, child := range typed {
			next, childChanged := sanitizeLogValue(child)
			sanitized[key] = next
			changed = changed || childChanged
		}
		return sanitized, changed
	case []any:
		changed := false
		sanitized := make([]any, len(typed))
		for index, child := range typed {
			next, childChanged := sanitizeLogValue(child)
			sanitized[index] = next
			changed = changed || childChanged
		}
		return sanitized, changed
	case string:
		return sanitizeLogString(typed)
	default:
		return value, false
	}
}

func sanitizeLogString(s string) (string, bool) {
	if len(s) < 500 {
		return s, false
	}
	if strings.HasPrefix(strings.TrimSpace(s), "{") || strings.HasPrefix(strings.TrimSpace(s), "[") {
		var payload any
		if err := json.Unmarshal([]byte(s), &payload); err == nil {
			if sanitized, changed := sanitizeLogValue(payload); changed {
				if encoded, marshalErr := json.Marshal(sanitized); marshalErr == nil {
					return string(encoded), true
				}
			}
		}
	}
	return sanitizeLongLogString(s)
}

func sanitizeLongLogString(s string) (string, bool) {
	const maxPlainTextLogChars = 8192
	if marker, ok := stripDataURLBase64(s); ok {
		return marker, true
	}
	if isLikelyBase64Payload(s) {
		return fmt.Sprintf("[base64 ~%d chars]", len(strings.ReplaceAll(strings.ReplaceAll(s, "\r", ""), "\n", ""))), true
	}
	if len(s) > maxPlainTextLogChars {
		return fmt.Sprintf("%s...[truncated %d chars]", s[:maxPlainTextLogChars], len(s)-maxPlainTextLogChars), true
	}
	return s, false
}

func stripDataURLBase64(s string) (string, bool) {
	const marker = ";base64,"
	index := strings.Index(s, marker)
	if index < 0 {
		return "", false
	}
	prefixEnd := index + len(marker)
	if prefixEnd >= len(s) {
		return s, false
	}
	return fmt.Sprintf("%s[base64 ~%d chars]", s[:prefixEnd], len(s)-prefixEnd), true
}

func isLikelyBase64Payload(s string) bool {
	normalized := strings.ReplaceAll(strings.ReplaceAll(s, "\r", ""), "\n", "")
	if len(normalized) < 500 {
		return false
	}
	for _, char := range normalized {
		if (char >= 'A' && char <= 'Z') || (char >= 'a' && char <= 'z') || (char >= '0' && char <= '9') || char == '+' || char == '/' || char == '=' {
			continue
		}
		return false
	}
	return true
}

type RequestTrace struct {
	Id                  int                   `json:"id"`
	RequestId           string                `json:"request_id" gorm:"type:varchar(64);uniqueIndex:idx_request_traces_request_id"`
	UserId              int                   `json:"user_id" gorm:"index"`
	Username            string                `json:"username" gorm:"index;default:''"`
	RequestPath         string                `json:"request_path" gorm:"default:''"`
	ModelName           string                `json:"model_name" gorm:"index;default:''"`
	OriginalRequestBody string                `json:"original_request_body"`
	AttemptsJSON        string                `json:"-" gorm:"column:attempts_json"`
	CreatedAt           int64                 `json:"created_at" gorm:"bigint;index"`
	UpdatedAt           int64                 `json:"updated_at" gorm:"bigint"`
	Attempts            []RequestTraceAttempt `json:"attempts" gorm:"-"`
}

type RequestTraceAttempt struct {
	RetryIndex           int      `json:"retry_index"`
	ChannelId            int      `json:"channel_id"`
	RequestModel         string   `json:"request_model"`
	UpstreamModel        string   `json:"upstream_model"`
	UpstreamURL          string   `json:"upstream_url"`
	RequestConversion    []string `json:"request_conversion"`
	UpstreamRequestBody  string   `json:"upstream_request_body"`
	UpstreamResponseBody string   `json:"upstream_response_body"`
	ErrorMessage         string   `json:"error_message"`
}

type RequestTraceAttemptPatch struct {
	RetryIndex           int
	ChannelId            int
	RequestModel         string
	UpstreamModel        string
	UpstreamURL          string
	RequestConversion    []string
	UpstreamRequestBody  string
	UpstreamResponseBody string
	ErrorMessage         string
}

func (trace *RequestTrace) hydrateAttempts() error {
	if trace == nil {
		return nil
	}
	if trace.AttemptsJSON == "" {
		trace.Attempts = []RequestTraceAttempt{}
		return nil
	}
	var attempts []RequestTraceAttempt
	if err := common.Unmarshal([]byte(trace.AttemptsJSON), &attempts); err != nil {
		return err
	}
	trace.Attempts = attempts
	return nil
}

func (trace *RequestTrace) persistAttempts() {
	if trace == nil {
		return
	}
	trace.AttemptsJSON = common.GetJsonString(trace.Attempts)
}

func loadRequestTraceByRequestID(requestId string) (*RequestTrace, error) {
	var trace RequestTrace
	err := LOG_DB.Where("request_id = ?", requestId).First(&trace).Error
	if err != nil {
		return nil, err
	}
	if err := trace.hydrateAttempts(); err != nil {
		return nil, err
	}
	return &trace, nil
}

func getOrInitRequestTrace(c *gin.Context, info *relaycommon.RelayInfo) *RequestTrace {
	requestId := ""
	username := ""
	if c != nil {
		requestId = c.GetString(common.RequestIdKey)
		username = c.GetString("username")
	}
	trace := &RequestTrace{
		RequestId: requestId,
		Username:  username,
		Attempts:  []RequestTraceAttempt{},
		CreatedAt: common.GetTimestamp(),
		UpdatedAt: common.GetTimestamp(),
	}
	if info != nil {
		trace.UserId = info.UserId
		trace.ModelName = info.OriginModelName
		trace.RequestPath = info.RequestURLPath
	}
	if c != nil && c.Request != nil && c.Request.URL != nil && c.Request.URL.Path != "" {
		trace.RequestPath = c.Request.URL.Path
	}
	return trace
}

func UpsertRequestTraceOriginal(c *gin.Context, info *relaycommon.RelayInfo, originalBody string) error {
	trace := getOrInitRequestTrace(c, info)
	if trace.RequestId == "" {
		return nil
	}
	existing, err := loadRequestTraceByRequestID(trace.RequestId)
	if err != nil && !errors.Is(err, gorm.ErrRecordNotFound) {
		return err
	}
	if existing != nil {
		trace = existing
	}
	if info != nil {
		trace.UserId = info.UserId
		trace.ModelName = info.OriginModelName
	}
	if trace.Username == "" && c != nil {
		trace.Username = c.GetString("username")
	}
	if trace.RequestPath == "" {
		if c != nil && c.Request != nil && c.Request.URL != nil {
			trace.RequestPath = c.Request.URL.Path
		}
		if trace.RequestPath == "" && info != nil {
			trace.RequestPath = info.RequestURLPath
		}
	}
	trace.OriginalRequestBody = truncateTraceBase64(originalBody)
	trace.UpdatedAt = common.GetTimestamp()
	trace.persistAttempts()
	return LOG_DB.Save(trace).Error
}

func UpsertRequestTraceAttempt(c *gin.Context, info *relaycommon.RelayInfo, patch RequestTraceAttemptPatch) error {
	trace := getOrInitRequestTrace(c, info)
	if trace.RequestId == "" {
		return nil
	}
	existing, err := loadRequestTraceByRequestID(trace.RequestId)
	if err != nil && !errors.Is(err, gorm.ErrRecordNotFound) {
		return err
	}
	if existing != nil {
		trace = existing
	}
	if trace.Attempts == nil {
		trace.Attempts = []RequestTraceAttempt{}
	}

	attemptIndex := -1
	for index := range trace.Attempts {
		if trace.Attempts[index].RetryIndex == patch.RetryIndex {
			attemptIndex = index
			break
		}
	}
	if attemptIndex == -1 {
		trace.Attempts = append(trace.Attempts, RequestTraceAttempt{
			RetryIndex: patch.RetryIndex,
		})
		attemptIndex = len(trace.Attempts) - 1
	}

	attempt := trace.Attempts[attemptIndex]
	if patch.ChannelId != 0 {
		attempt.ChannelId = patch.ChannelId
	}
	if patch.RequestModel != "" {
		attempt.RequestModel = patch.RequestModel
	}
	if patch.UpstreamModel != "" {
		attempt.UpstreamModel = patch.UpstreamModel
	}
	if patch.UpstreamURL != "" {
		attempt.UpstreamURL = patch.UpstreamURL
	}
	if len(patch.RequestConversion) > 0 {
		attempt.RequestConversion = patch.RequestConversion
	}
	if patch.UpstreamRequestBody != "" {
		attempt.UpstreamRequestBody = truncateTraceBase64(patch.UpstreamRequestBody)
	}
	if patch.UpstreamResponseBody != "" {
		attempt.UpstreamResponseBody = truncateTraceBase64(patch.UpstreamResponseBody)
	}
	if patch.ErrorMessage != "" {
		attempt.ErrorMessage = patch.ErrorMessage
	}
	trace.Attempts[attemptIndex] = attempt

	if info != nil {
		trace.UserId = info.UserId
		trace.ModelName = info.OriginModelName
	}
	if trace.Username == "" && c != nil {
		trace.Username = c.GetString("username")
	}
	if trace.RequestPath == "" {
		if c != nil && c.Request != nil && c.Request.URL != nil {
			trace.RequestPath = c.Request.URL.Path
		}
		if trace.RequestPath == "" && info != nil {
			trace.RequestPath = info.RequestURLPath
		}
	}
	trace.UpdatedAt = common.GetTimestamp()
	trace.persistAttempts()
	return LOG_DB.Save(trace).Error
}

func GetRequestTraceByRequestID(requestId string) (*RequestTrace, error) {
	trace, err := loadRequestTraceByRequestID(requestId)
	if err != nil {
		return nil, err
	}
	return trace, nil
}

func GetUserRequestTraceByRequestID(userId int, requestId string) (*RequestTrace, error) {
	var trace RequestTrace
	err := LOG_DB.Where("request_id = ? AND user_id = ?", requestId, userId).First(&trace).Error
	if err != nil {
		return nil, err
	}
	if err := trace.hydrateAttempts(); err != nil {
		return nil, err
	}
	return &trace, nil
}
