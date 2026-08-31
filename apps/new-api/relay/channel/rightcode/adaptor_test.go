package rightcode

import (
	"testing"

	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/dto"
	"github.com/QuantumNous/new-api/relay/channel/claude/oauth"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	relayconstant "github.com/QuantumNous/new-api/relay/constant"
)

func TestGrokModelRoutingHelpers(t *testing.T) {
	t.Parallel()

	if !isGrokModel(" grok-4.5 ") {
		t.Fatal("expected grok-4.5 to be recognized as a Grok model")
	}
	if isGrokModel("gpt-5.6") {
		t.Fatal("did not expect a GPT model to be recognized as a Grok model")
	}

	const base = "https://www.right.codes/codex-pro/v1"
	if got, want := grokBaseURL(base), "https://www.right.codes/grok"; got != want {
		t.Fatalf("grokBaseURL() = %q, want %q", got, want)
	}
	if got, want := rootBaseURL("https://right.codes/grok/v1"), "https://right.codes"; got != want {
		t.Fatalf("rootBaseURL() = %q, want %q", got, want)
	}

	adaptor := &Adaptor{}
	requestURL, err := adaptor.GetRequestURL(&relaycommon.RelayInfo{
		RelayMode:      relayconstant.RelayModeResponses,
		RequestURLPath: "/v1/responses",
		ChannelMeta: &relaycommon.ChannelMeta{
			ChannelType:       constant.ChannelTypeRightCode,
			ChannelBaseUrl:    base,
			UpstreamModelName: "grok-4.5",
		},
	})
	if err != nil {
		t.Fatalf("GetRequestURL() returned error: %v", err)
	}
	if want := "https://www.right.codes/grok/v1/responses"; requestURL != want {
		t.Fatalf("GetRequestURL() = %q, want %q", requestURL, want)
	}
}

func TestConvertClaudeRequestEnsuresClaudeCodeIdentity(t *testing.T) {
	t.Parallel()

	request := &dto.ClaudeRequest{
		Model:  "claude-fable-5",
		System: "project instructions",
	}
	converted, err := (&Adaptor{}).ConvertClaudeRequest(nil, &relaycommon.RelayInfo{
		ChannelMeta: &relaycommon.ChannelMeta{UpstreamModelName: "claude-fable-5"},
	}, request)
	if err != nil {
		t.Fatalf("ConvertClaudeRequest() error = %v", err)
	}
	got := converted.(*dto.ClaudeRequest)
	blocks, ok := got.System.([]any)
	if !ok || len(blocks) != 2 {
		t.Fatalf("system = %#v, want identity plus original system", got.System)
	}
	first, ok := blocks[0].(map[string]any)
	if !ok || first["text"] != oauth.ClaudeCodeSystemPrompt {
		t.Fatalf("first block = %#v, want Claude Code identity", blocks[0])
	}
}

func TestClaudeTierRouting(t *testing.T) {
	t.Parallel()

	cases := []struct {
		base string
		want string
	}{
		// claude tier variant honoured as-is (rightapi.ai/claude-bug SPA
		// returns 200+HTML on unknown routes, so a wrong path yields an
		// empty SSE stream instead of an error)
		{"https://rightapi.ai/claude-bug", "https://rightapi.ai/claude-bug"},
		{"https://rightapi.ai/claude-bug/v1", "https://rightapi.ai/claude-bug"},
		{"https://www.right.codes/claude", "https://www.right.codes/claude"},
		// non-claude bases fall back to {root}/claude
		{"https://www.right.codes", "https://www.right.codes/claude"},
		{"https://www.right.codes/codex-pro/v1", "https://www.right.codes/claude"},
		// hostname starting with "claude" is not a tier
		{"https://claude.example.com", "https://claude.example.com/claude"},
	}
	for _, tc := range cases {
		if got := claudeBaseURL(tc.base); got != tc.want {
			t.Fatalf("claudeBaseURL(%q) = %q, want %q", tc.base, got, tc.want)
		}
	}

	if got, want := rootBaseURL("https://rightapi.ai/claude-bug"), "https://rightapi.ai"; got != want {
		t.Fatalf("rootBaseURL() = %q, want %q", got, want)
	}

	adaptor := &Adaptor{}
	requestURL, err := adaptor.GetRequestURL(&relaycommon.RelayInfo{
		RelayMode:      relayconstant.RelayModeChatCompletions,
		RequestURLPath: "/v1/chat/completions",
		ChannelMeta: &relaycommon.ChannelMeta{
			ChannelType:       constant.ChannelTypeRightCode,
			ChannelBaseUrl:    "https://rightapi.ai/claude-bug",
			UpstreamModelName: "claude-fable-5",
		},
	})
	if err != nil {
		t.Fatalf("GetRequestURL() returned error: %v", err)
	}
	if want := "https://rightapi.ai/claude-bug/v1/messages"; requestURL != want {
		t.Fatalf("GetRequestURL() = %q, want %q", requestURL, want)
	}
}
