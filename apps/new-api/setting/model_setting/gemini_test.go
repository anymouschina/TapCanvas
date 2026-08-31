package model_setting

import "testing"

func TestGeminiCodeAssistProductionImageModelIsSupported(t *testing.T) {
	if !IsGeminiModelSupportImagine("gemini-3.1-flash-image") {
		t.Fatal("gemini-3.1-flash-image must be accepted after a channel maps the catalog alias to the Antigravity upstream model")
	}
}

func TestGeminiProImagePreviewIsSupported(t *testing.T) {
	if !IsGeminiModelSupportImagine("gemini-3-pro-image-preview") {
		t.Fatal("gemini-3-pro-image-preview must be accepted by Gemini image conversion")
	}
}

func TestGeminiProImageProductionModelIsSupported(t *testing.T) {
	if !IsGeminiModelSupportImagine("gemini-3-pro-image") {
		t.Fatal("gemini-3-pro-image must be accepted after a channel maps the catalog alias to the production upstream model")
	}
}

func TestShouldForceOfficialGeminiChannel(t *testing.T) {
	previous := geminiSettings.OfficialChannelOnlyEnabled
	t.Cleanup(func() {
		geminiSettings.OfficialChannelOnlyEnabled = previous
	})

	geminiSettings.OfficialChannelOnlyEnabled = true
	if !ShouldForceOfficialGeminiChannel("gemini-3.1-pro-preview") {
		t.Fatal("gemini-* requests must use the official channel when the switch is enabled")
	}
	if ShouldForceOfficialGeminiChannel("nano-banana-pro") {
		t.Fatal("non-gemini aliases must not be captured by the official-channel switch")
	}

	geminiSettings.OfficialChannelOnlyEnabled = false
	if ShouldForceOfficialGeminiChannel("gemini-3.1-pro-preview") {
		t.Fatal("the official channel must not be forced while the switch is disabled")
	}
}
