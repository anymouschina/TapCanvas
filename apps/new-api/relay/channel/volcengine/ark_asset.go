package volcengine

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"regexp"
	"strings"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/service"
)

var seedance2Re = regexp.MustCompile(
	`(?:^|[-_.])seedance[-_.]?2(?:(?:[-_.]?(?:0|5))(?:$|[-_.])|$|[-_.][a-z])`,
)

type arkConfig struct {
	accessKey   string
	secretKey   string
	region      string
	host        string
	projectName string
}

func readArkConfig() arkConfig {
	return arkConfig{
		accessKey:   common.GetEnvOrDefaultString("VOLC_ARK_ACCESS_KEY", ""),
		secretKey:   common.GetEnvOrDefaultString("VOLC_ARK_SECRET_KEY", ""),
		region:      common.GetEnvOrDefaultString("VOLC_ARK_REGION", "cn-beijing"),
		host:        common.GetEnvOrDefaultString("VOLC_ARK_API_HOST", "open.volcengineapi.com"),
		projectName: common.GetEnvOrDefaultString("VOLC_ARK_PROJECT_NAME", "default"),
	}
}

// ArkConfigured 返回是否配置了 ARK 审核所需的密钥。
func ArkConfigured() bool {
	c := readArkConfig()
	return c.accessKey != "" && c.secretKey != ""
}

// isSeedance2VideoModel 对齐 hono isArkSeedance2Model：Seedance 2.x 官渠家族
// （当前 2.0 / 2.5），
// 排除 -face（直传 URL）与 apimart 聚合条目。
func isSeedance2VideoModel(modelName string) bool {
	m := strings.ToLower(strings.TrimSpace(modelName))
	if m == "" {
		return false
	}
	if strings.Contains(m, "face") || strings.Contains(m, "apimart") {
		return false
	}
	return seedance2Re.MatchString(m)
}

// IsSeedance2VideoModel 导出版，供其它 package（如 task/doubao adaptor）判定续写路径
// metadata.content 内嵌图是否需要补做 ARK 素材上传。
func IsSeedance2VideoModel(modelName string) bool {
	return isSeedance2VideoModel(modelName)
}

// RequiresArkAssetUpload 判定请求是否命中 ARK 官渠 Seedance 2.x 素材上传链路。
func RequiresArkAssetUpload(channelType int, modelName string) bool {
	return ArkConfigured() &&
		channelType == constant.ChannelTypeVolcEngine &&
		isSeedance2VideoModel(modelName)
}

// RequiresArkModeration 保留图片调用方的便捷判定。
func RequiresArkModeration(channelType int, modelName string, hasImage bool) bool {
	return hasImage && RequiresArkAssetUpload(channelType, modelName)
}

// ArkModerationError 承载硬拦分类：
// Rejected=true 内容被拒(HTTP 4xx)；false 技术性失败/不可用(HTTP 5xx)。
// RejectedURLs 记录被拒的原始媒体 URL，供调用方定位对应参考素材。
type ArkModerationError struct {
	Rejected     bool
	Message      string
	RejectedURLs []string
}

func (e *ArkModerationError) Error() string { return e.Message }

func newArkRejected(format string, a ...interface{}) *ArkModerationError {
	return &ArkModerationError{Rejected: true, Message: fmt.Sprintf(format, a...)}
}

func newArkUnavailable(format string, a ...interface{}) *ArkModerationError {
	return &ArkModerationError{Rejected: false, Message: fmt.Sprintf(format, a...)}
}

const (
	arkAssetVersion = "2024-01-01"
	arkAssetService = "ark"
	arkPollTimeout  = 120 * time.Second
	arkPollInterval = 3 * time.Second
	arkMaxAttempts  = 3
)

var arkTransientRe = regexp.MustCompile(`timeout|internal|throttl|toomany|gateway|5\d\d`)

type arkMetaError struct {
	Code    string `json:"Code"`
	Message string `json:"Message"`
}

type arkResponse struct {
	Result           json.RawMessage `json:"Result"`
	ResponseMetadata struct {
		Error *arkMetaError `json:"Error"`
	} `json:"ResponseMetadata"`
}

func arkTruncate(s string, n int) string {
	if len(s) > n {
		return s[:n]
	}
	return s
}

// arkCallOnce 发一次签名请求，返回 (Result, retryable, err)。
func arkCallOnce(cfg arkConfig, action string, body map[string]interface{}) (json.RawMessage, bool, error) {
	jsonBody, err := common.Marshal(body)
	if err != nil {
		return nil, false, err
	}
	signed := signArkRequest(arkSignInput{
		accessKey: cfg.accessKey, secretKey: cfg.secretKey,
		region: cfg.region, service: arkAssetService, host: cfg.host,
		method: "POST", action: action, version: arkAssetVersion,
		body: string(jsonBody), date: time.Now(),
	})
	client, err := service.GetHttpClientWithProxy("")
	if err != nil {
		return nil, true, err
	}
	req, err := http.NewRequest(http.MethodPost, signed.url, bytes.NewReader(jsonBody))
	if err != nil {
		return nil, false, err
	}
	for k, v := range signed.headers {
		if k == "Host" {
			req.Host = v
			continue
		}
		req.Header.Set(k, v)
	}
	resp, err := client.Do(req)
	if err != nil {
		return nil, true, err // 网络错误 → 可重试
	}
	respBody, _ := io.ReadAll(resp.Body)
	_ = resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		retryable := resp.StatusCode >= 500 || resp.StatusCode == 429
		return nil, retryable, fmt.Errorf("%s: http %d: %s", action, resp.StatusCode, arkTruncate(string(respBody), 200))
	}
	var parsed arkResponse
	if err := common.Unmarshal(respBody, &parsed); err != nil {
		return nil, false, fmt.Errorf("%s: invalid json: %s", action, arkTruncate(string(respBody), 200))
	}
	if parsed.ResponseMetadata.Error != nil && parsed.ResponseMetadata.Error.Code != "" {
		code := parsed.ResponseMetadata.Error.Code
		retryable := arkTransientRe.MatchString(strings.ToLower(code))
		return nil, retryable, fmt.Errorf("%s: [%s] %s", action, code, parsed.ResponseMetadata.Error.Message)
	}
	return parsed.Result, false, nil
}

// arkCall 带瞬时错误重试（共 arkMaxAttempts 次，退避 1.5s/3s）。
func arkCall(cfg arkConfig, action string, body map[string]interface{}) (json.RawMessage, error) {
	var lastErr error
	for attempt := 0; attempt < arkMaxAttempts; attempt++ {
		result, retryable, err := arkCallOnce(cfg, action, body)
		if err == nil {
			return result, nil
		}
		lastErr = err
		if !retryable {
			break
		}
		time.Sleep(time.Duration(1500*(attempt+1)) * time.Millisecond)
	}
	return nil, lastErr
}

func createAssetGroup(cfg arkConfig) (string, error) {
	date := time.Now().UTC().Add(8 * time.Hour).Format("2006-01-02")
	result, err := arkCall(cfg, "CreateAssetGroup", map[string]interface{}{
		"Name":        fmt.Sprintf("tapcanvas-review-%s-%d", date, time.Now().UnixNano()),
		"Description": "TapCanvas ARK review group " + date,
		"GroupType":   "AIGC",
		"ProjectName": cfg.projectName,
	})
	if err != nil {
		return "", err
	}
	var r struct {
		Id string `json:"Id"`
	}
	if err := common.Unmarshal(result, &r); err != nil || r.Id == "" {
		return "", fmt.Errorf("CreateAssetGroup: empty Id")
	}
	return r.Id, nil
}

// ArkAssetType 是火山方舟 CreateAsset 接口接受的素材类型。
type ArkAssetType string

const (
	ArkAssetTypeImage ArkAssetType = "Image"
	ArkAssetTypeVideo ArkAssetType = "Video"
	ArkAssetTypeAudio ArkAssetType = "Audio"
)

// SeedanceAssetInput 描述一次官渠 Seedance 请求中的外部参考素材。
type SeedanceAssetInput struct {
	URL  string
	Type ArkAssetType
}

func createAsset(cfg arkConfig, groupID, sourceURL string, assetType ArkAssetType) (string, error) {
	result, err := arkCall(cfg, "CreateAsset", createAssetRequestBody(cfg, groupID, sourceURL, assetType))
	if err != nil {
		return "", err
	}
	var r struct {
		Id string `json:"Id"`
	}
	if err := common.Unmarshal(result, &r); err != nil || r.Id == "" {
		return "", fmt.Errorf("CreateAsset: empty Id")
	}
	return r.Id, nil
}

func createAssetRequestBody(cfg arkConfig, groupID, sourceURL string, assetType ArkAssetType) map[string]interface{} {
	return map[string]interface{}{
		"GroupId":     groupID,
		"URL":         sourceURL,
		"AssetType":   string(assetType),
		"ProjectName": cfg.projectName,
	}
}

// pollAssetActive 轮询素材状态：active→nil；failed→内容被拒(rejected)；超时→不可用。
func pollAssetActive(cfg arkConfig, assetID string) error {
	deadline := time.Now().Add(arkPollTimeout)
	for time.Now().Before(deadline) {
		result, err := arkCall(cfg, "GetAsset", map[string]interface{}{
			"Id": assetID, "ProjectName": cfg.projectName,
		})
		if err != nil {
			return newArkUnavailable("GetAsset %s: %v", assetID, err)
		}
		var r struct {
			Status string `json:"Status"`
		}
		_ = common.Unmarshal(result, &r)
		switch strings.ToLower(r.Status) {
		case "active":
			return nil
		case "failed":
			return newArkRejected("asset %s 内容审核未通过", assetID)
		}
		time.Sleep(arkPollInterval)
	}
	return newArkUnavailable("asset %s 审核/上传超时", assetID)
}

// DeleteArkAssetGroup 删除一个素材组（供清理任务调用）。
func DeleteArkAssetGroup(groupID string) error {
	if !ArkConfigured() || groupID == "" {
		return nil
	}
	cfg := readArkConfig()
	_, err := arkCall(cfg, "DeleteAssetGroup", map[string]interface{}{
		"Id": groupID, "ProjectName": cfg.projectName,
	})
	return err
}

func asArkError(err error) error {
	var me *ArkModerationError
	if errors.As(err, &me) {
		return me
	}
	return newArkUnavailable("%v", err)
}

// ModerateSeedanceAssets 把每个外部图片、视频或音频 URL 上传 ARK 为审核素材，返回
// asset://<id> 引用。拒绝/技术失败一律返回 *ArkModerationError 硬拦，绝不降级回原 URL。
// 已是 asset:// 的条目原样保留。
func ModerateSeedanceAssets(inputs []SeedanceAssetInput) ([]string, error) {
	cfg := readArkConfig()
	if cfg.accessKey == "" || cfg.secretKey == "" {
		return nil, newArkUnavailable("VOLC_ARK_ACCESS_KEY / VOLC_ARK_SECRET_KEY 未配置")
	}
	needUpload := false
	for _, input := range inputs {
		if !strings.HasPrefix(input.URL, "asset://") {
			needUpload = true
			break
		}
	}
	if !needUpload {
		out := make([]string, len(inputs))
		for i, input := range inputs {
			out[i] = input.URL
		}
		return out, nil
	}
	groupID, err := createAssetGroup(cfg)
	if err != nil {
		return nil, newArkUnavailable("CreateAssetGroup: %v", err)
	}
	// 持久化 group 供后台清理（best-effort，不阻断）。
	if recErr := model.RecordArkAssetGroup(groupID); recErr != nil {
		common.SysError("record ark asset group failed " + groupID + ": " + recErr.Error())
	}

	out := make([]string, len(inputs))
	var rejected []string
	for i, input := range inputs {
		if strings.HasPrefix(input.URL, "asset://") {
			out[i] = input.URL
			continue
		}
		assetID, err := createAsset(cfg, groupID, input.URL, input.Type)
		if err != nil {
			return nil, asArkError(err)
		}
		if err := pollAssetActive(cfg, assetID); err != nil {
			// 内容被拒：记录原始 URL 并继续审核余下素材，凑齐全部被拒清单；
			// 技术性失败/超时（不可用）无法归因到具体素材，直接硬拦返回。
			var me *ArkModerationError
			if errors.As(err, &me) && me.Rejected {
				rejected = append(rejected, input.URL)
				continue
			}
			return nil, asArkError(err)
		}
		out[i] = "asset://" + assetID
	}
	if len(rejected) > 0 {
		e := newArkRejected("内容审核未通过：%d 个参考素材被拒", len(rejected))
		e.RejectedURLs = rejected
		return nil, e
	}
	return out, nil
}

// ModerateSeedanceImages 保留图片入口，统一委托给多媒体素材上传实现。
func ModerateSeedanceImages(urls []string) ([]string, error) {
	inputs := make([]SeedanceAssetInput, len(urls))
	for i, url := range urls {
		inputs[i] = SeedanceAssetInput{URL: url, Type: ArkAssetTypeImage}
	}
	return ModerateSeedanceAssets(inputs)
}

// ---- 后台清理 ----

const (
	arkGroupSweepMinAge   = 10 * time.Minute
	arkGroupCleanupPeriod = 10 * time.Minute
)

var arkCleanupStarted bool

// StartArkAssetGroupCleanup 启动后台 goroutine，周期删除超安全期的素材组。
// 幂等（重复调用只启一次）；未配置 VOLC_ARK_* 时不启动。
func StartArkAssetGroupCleanup() {
	if !ArkConfigured() || arkCleanupStarted {
		return
	}
	arkCleanupStarted = true
	go func() {
		time.Sleep(60 * time.Second) // 启动稍后先清理上次进程遗留旧组
		sweepStaleArkAssetGroups()
		ticker := time.NewTicker(arkGroupCleanupPeriod)
		defer ticker.Stop()
		for range ticker.C {
			sweepStaleArkAssetGroups()
		}
	}()
}

func sweepStaleArkAssetGroups() {
	if !ArkConfigured() {
		return
	}
	ids, err := model.ListStaleArkAssetGroups(int64(arkGroupSweepMinAge.Seconds()))
	if err != nil {
		common.SysError("ark asset group sweep list failed: " + err.Error())
		return
	}
	for _, id := range ids {
		if err := DeleteArkAssetGroup(id); err != nil {
			common.SysError("ark asset group delete failed " + id + ": " + err.Error())
			continue // 删除失败保留 DB 记录，下次重试
		}
		_ = model.ForgetArkAssetGroup(id)
	}
}
