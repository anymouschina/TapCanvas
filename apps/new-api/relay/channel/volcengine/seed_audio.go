package volcengine

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"errors"
	"io"
	"math"
	"net/http"
	"os"
	"strconv"
	"strings"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/dto"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	"github.com/QuantumNous/new-api/types"

	"github.com/gin-gonic/gin"
)

// doubao-seed-audio-1-0 是火山「豆包语音」的音频生成模型，走同步 HTTP（非
// volcano_tts WebSocket），端点 openspeech /api/v3/tts/create，X-Api-Key 单头鉴权。
// 文档：https://www.volcengine.com/docs/6561/2550782
const (
	seedAudioModelName  = "seed-audio-1.0"
	seedAudioCreateURL  = "https://openspeech.bytedance.com/api/v3/tts/create"
	seedAudioMaxSeconds = 120

	// 单轨计费唯一价格源：每秒 original_duration 对应的积分。env 可覆盖（运维侧调价），
	// 后端按响应头 X-NewApi-Consumed-Credits 实扣，不在后端再设一份价格。
	// 定价 1.2 元/分钟，1 元=100 积分 → 120 积分/分钟 → 2 积分/秒（封顶 120s=240 积分/次）。
	seedAudioDefaultCreditsPerSecond = 2.0
	seedAudioCreditsPerSecondEnv     = "SEED_AUDIO_CREDITS_PER_SECOND"

	// 响应头桥：把 new-api 算出的实际积分与时长回传给后端做单轨后扣。
	headerConsumedCredits = "X-NewApi-Consumed-Credits"
	headerAudioDuration   = "X-NewApi-Audio-Duration"
)

func isSeedAudioModel(model string) bool {
	return strings.HasPrefix(strings.ToLower(model), "doubao-seed-audio")
}

// SeedAudioConfig 输出音频配置。speech/loudness/pitch 默认 0 即「不调整」，
// 故零值省略与显式 0 语义一致，使用 omitempty 安全。
type SeedAudioConfig struct {
	Format       string `json:"format,omitempty"`
	SampleRate   int    `json:"sample_rate,omitempty"`
	SpeechRate   int    `json:"speech_rate,omitempty"`
	LoudnessRate int    `json:"loudness_rate,omitempty"`
	PitchRate    int    `json:"pitch_rate,omitempty"`
}

type SeedAudioRequest struct {
	Model       string          `json:"model"`
	TextPrompt  string          `json:"text_prompt"`
	AudioURL    string          `json:"audio_url,omitempty"`
	AudioData   string          `json:"audio_data,omitempty"`
	ImageURL    string          `json:"image_url,omitempty"`
	ImageData   string          `json:"image_data,omitempty"`
	References  json.RawMessage `json:"references,omitempty"`
	AudioConfig SeedAudioConfig `json:"audio_config"`
	Watermark   json.RawMessage `json:"watermark,omitempty"`
}

type SeedAudioResponse struct {
	Code             int     `json:"code"`
	Message          string  `json:"message"`
	Audio            string  `json:"audio"`
	Duration         float64 `json:"duration"`
	OriginalDuration float64 `json:"original_duration"`
	URL              string  `json:"url"`
}

// seedAudioMeta 是从 AudioRequest.Metadata 透传过来的 seed-audio 专有字段。
type seedAudioMeta struct {
	SampleRate   int             `json:"sample_rate,omitempty"`
	LoudnessRate int             `json:"loudness_rate,omitempty"`
	PitchRate    int             `json:"pitch_rate,omitempty"`
	AudioURL     string          `json:"audio_url,omitempty"`
	AudioData    string          `json:"audio_data,omitempty"`
	ImageURL     string          `json:"image_url,omitempty"`
	ImageData    string          `json:"image_data,omitempty"`
	References   json.RawMessage `json:"references,omitempty"`
	Watermark    json.RawMessage `json:"watermark,omitempty"`
}

func clampInt(v, lo, hi int) int {
	if v < lo {
		return lo
	}
	if v > hi {
		return hi
	}
	return v
}

// buildSeedAudioRequest 将 OpenAI 音频字段 + metadata 映射成 seed-audio 请求体。
func buildSeedAudioRequest(input, voice, format string, speedRatio float64, metadata json.RawMessage) SeedAudioRequest {
	if format == "" {
		format = "wav"
	}
	req := SeedAudioRequest{
		Model:      seedAudioModelName,
		TextPrompt: input,
		AudioConfig: SeedAudioConfig{
			Format:     format,
			SpeechRate: clampInt(int(math.Round(speedRatio)), -50, 100),
		},
	}
	speaker := strings.TrimSpace(voice)
	if len(metadata) > 0 {
		var m seedAudioMeta
		if err := common.Unmarshal(metadata, &m); err == nil {
			req.AudioConfig.SampleRate = m.SampleRate
			req.AudioConfig.LoudnessRate = clampInt(m.LoudnessRate, -50, 100)
			req.AudioConfig.PitchRate = clampInt(m.PitchRate, -12, 12)
			req.AudioURL, req.AudioData = m.AudioURL, m.AudioData
			req.ImageURL, req.ImageData = m.ImageURL, m.ImageData
			req.References, req.Watermark = m.References, m.Watermark
			// 音色（预设 speaker）与参考资源（audio/image/references）互斥：
			// 有参考资源时清空 speaker。
			if m.AudioURL != "" || m.AudioData != "" || m.ImageURL != "" || m.ImageData != "" || len(m.References) > 0 {
				speaker = ""
			}
		}
	}
	// 音色必须以 references:[{"speaker":...}] 形式下发；上游
	// /api/v3/tts/create 不接受顶层 speaker 字段（实测会被忽略）。
	if speaker != "" {
		if data, err := common.Marshal([]map[string]string{{"speaker": speaker}}); err == nil {
			req.References = json.RawMessage(data)
		}
	}
	return req
}

// convertSeedAudioRequest 在 adaptor.ConvertAudioRequest 的 seed-audio 分支调用。
func convertSeedAudioRequest(request dto.AudioRequest) (io.Reader, error) {
	body := buildSeedAudioRequest(
		request.Input,
		request.Voice,
		request.ResponseFormat,
		floatFromPtr(request.Speed),
		request.Metadata,
	)
	data, err := common.Marshal(body)
	if err != nil {
		return nil, err
	}
	return bytes.NewReader(data), nil
}

func floatFromPtr(p *float64) float64 {
	if p == nil {
		return 0
	}
	return *p
}

func seedAudioCreditsPerSecond() float64 {
	if raw := strings.TrimSpace(os.Getenv(seedAudioCreditsPerSecondEnv)); raw != "" {
		if v, err := strconv.ParseFloat(raw, 64); err == nil && v >= 0 {
			return v
		}
	}
	return seedAudioDefaultCreditsPerSecond
}

// computeSeedAudioCredits 按 original_duration 秒数计价（向上取整秒，封顶 120s）。
func computeSeedAudioCredits(originalDuration float64) int64 {
	secs := originalDuration
	if secs > seedAudioMaxSeconds {
		secs = seedAudioMaxSeconds
	}
	if secs < 0 {
		secs = 0
	}
	return int64(math.Ceil(secs * seedAudioCreditsPerSecond()))
}

// handleSeedAudioResponse 解析 seed-audio JSON 响应：写回音频字节（保持
// /v1/audio/speech 字节契约），并在写 body 前落计费桥响应头。
func handleSeedAudioResponse(c *gin.Context, resp *http.Response, info *relaycommon.RelayInfo) (usage any, err *types.NewAPIError) {
	defer resp.Body.Close()
	body, readErr := io.ReadAll(resp.Body)
	if readErr != nil {
		return nil, types.NewErrorWithStatusCode(
			errors.New("failed to read seed-audio response"),
			types.ErrorCodeReadResponseBodyFailed,
			http.StatusInternalServerError,
		)
	}

	var seedResp SeedAudioResponse
	if unmarshalErr := common.Unmarshal(body, &seedResp); unmarshalErr != nil {
		return nil, types.NewErrorWithStatusCode(
			errors.New("failed to parse seed-audio response: "+string(body)),
			types.ErrorCodeBadResponseBody,
			http.StatusInternalServerError,
		)
	}

	// 成功码为 0（错误码文档 6561/2534853）。
	if seedResp.Code != 0 {
		logid := resp.Header.Get("X-Tt-Logid")
		return nil, types.NewErrorWithStatusCode(
			errors.New("seed-audio upstream error: "+seedResp.Message+" (logid="+logid+")"),
			types.ErrorCodeBadResponse,
			http.StatusBadRequest,
		)
	}

	audioData, decodeErr := base64.StdEncoding.DecodeString(seedResp.Audio)
	if decodeErr != nil {
		return nil, types.NewErrorWithStatusCode(
			errors.New("failed to decode seed-audio base64 audio"),
			types.ErrorCodeBadResponseBody,
			http.StatusInternalServerError,
		)
	}

	// 计费桥：写 body 前落响应头（写 body 后 header 不可改）。
	credits := computeSeedAudioCredits(seedResp.OriginalDuration)
	c.Header(headerConsumedCredits, strconv.FormatInt(credits, 10))
	c.Header(headerAudioDuration, strconv.FormatFloat(seedResp.OriginalDuration, 'f', 2, 64))

	format := "wav"
	if len(audioData) > 0 {
		// 输出格式由请求 audio_config.format 决定，这里用上下文缓存的值兜底。
		if f := strings.TrimSpace(c.GetString(contextKeyResponseFormat)); f != "" {
			format = f
		}
	}
	contentType := getContentTypeByEncoding(format)
	c.Data(http.StatusOK, contentType, audioData)

	usage = &dto.Usage{
		PromptTokens:     info.GetEstimatePromptTokens(),
		CompletionTokens: 0,
		TotalTokens:      info.GetEstimatePromptTokens(),
	}
	return usage, nil
}
