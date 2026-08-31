package volcengine

import (
	"encoding/json"
	"testing"
)

func TestIsSeedAudioModel(t *testing.T) {
	if !isSeedAudioModel("doubao-seed-audio-1-0") {
		t.Fatal("expected seed-audio match")
	}
	if isSeedAudioModel("doubao-seedance-1-0-pro-250528") {
		t.Fatal("seedance must not match seed-audio")
	}
	if isSeedAudioModel("doubao-seedream-5-0-260128") {
		t.Fatal("seedream must not match seed-audio")
	}
}

// referenceSpeakers 解出 references:[{"speaker":...}] 的音色 ID 列表。
func referenceSpeakers(t *testing.T, raw json.RawMessage) []string {
	t.Helper()
	if len(raw) == 0 {
		return nil
	}
	var items []map[string]string
	if err := json.Unmarshal(raw, &items); err != nil {
		t.Fatalf("references not a [{...}] array: %q (%v)", string(raw), err)
	}
	speakers := make([]string, 0, len(items))
	for _, item := range items {
		if s, ok := item["speaker"]; ok {
			speakers = append(speakers, s)
		}
	}
	return speakers
}

func TestBuildSeedAudioBody_PlainText(t *testing.T) {
	body := buildSeedAudioRequest("你好世界", "zh_female_x", "mp3", 20, nil)
	if body.Model != seedAudioModelName {
		t.Fatalf("bad model: %q", body.Model)
	}
	if body.TextPrompt != "你好世界" {
		t.Fatalf("bad text_prompt: %q", body.TextPrompt)
	}
	// 音色以 references:[{"speaker":...}] 下发，而非顶层 speaker 字段。
	if got := referenceSpeakers(t, body.References); len(got) != 1 || got[0] != "zh_female_x" {
		t.Fatalf("expected references=[{speaker:zh_female_x}], got %q", string(body.References))
	}
	if body.AudioConfig.Format != "mp3" || body.AudioConfig.SpeechRate != 20 {
		t.Fatalf("bad audio_config: %+v", body.AudioConfig)
	}
}

func TestBuildSeedAudioBody_DefaultFormatAndClamp(t *testing.T) {
	body := buildSeedAudioRequest("hi", "", "", 999, nil)
	if body.AudioConfig.Format != "wav" {
		t.Fatalf("expected default wav, got %q", body.AudioConfig.Format)
	}
	if body.AudioConfig.SpeechRate != 100 {
		t.Fatalf("expected speech_rate clamped to 100, got %d", body.AudioConfig.SpeechRate)
	}
}

func TestBuildSeedAudioBody_ReferenceClearsSpeaker(t *testing.T) {
	meta := json.RawMessage(`{"audio_url":"https://x/a.mp3","pitch_rate":99,"loudness_rate":-99}`)
	body := buildSeedAudioRequest("hi", "zh_female_x", "wav", 0, meta)
	// 有音频参考时，预设音色互斥，references 不应注入 speaker。
	if got := referenceSpeakers(t, body.References); len(got) != 0 {
		t.Fatalf("expected no speaker reference when audio present, got %v", got)
	}
	if body.AudioURL != "https://x/a.mp3" {
		t.Fatalf("expected audio_url passthrough, got %q", body.AudioURL)
	}
	if body.AudioConfig.PitchRate != 12 || body.AudioConfig.LoudnessRate != -50 {
		t.Fatalf("expected pitch/loudness clamped, got %+v", body.AudioConfig)
	}
}

func TestComputeSeedAudioCredits(t *testing.T) {
	// default 2 credits/sec (1.2 元/分钟), ceil, capped at 120s -> 240
	if c := computeSeedAudioCredits(65.2); c != 131 {
		t.Fatalf("expected ceil(65.2*2)=131, got %d", c)
	}
	if c := computeSeedAudioCredits(200); c != 240 {
		t.Fatalf("expected cap 120s*2=240, got %d", c)
	}
	if c := computeSeedAudioCredits(0); c != 0 {
		t.Fatalf("expected 0, got %d", c)
	}
}
