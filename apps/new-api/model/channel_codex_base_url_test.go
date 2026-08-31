package model

import (
	"testing"

	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/dto"
)

func TestCodexBaseURLUsesExplicitNetworkExit(t *testing.T) {
	custom := "https://unexpected.example.com"
	channel := Channel{Type: constant.ChannelTypeCodex, BaseURL: &custom}

	channel.SetSetting(dto.ChannelSettings{CodexUseWorker: false})
	if got := channel.GetBaseURL(); got != "https://chatgpt.com" {
		t.Fatalf("official base URL = %q", got)
	}

	channel.SetSetting(dto.ChannelSettings{CodexUseWorker: true})
	if got := channel.GetBaseURL(); got != "https://sora2.beqlee.icu" {
		t.Fatalf("worker base URL = %q", got)
	}
}
