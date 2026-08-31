package claude

import (
	"testing"

	"github.com/QuantumNous/new-api/dto"
	"github.com/QuantumNous/new-api/relay/channel/claude/oauth"
)

func TestEnsureClaudeCodeSystemPrependsIdentity(t *testing.T) {
	request := &dto.ClaudeRequest{System: "project instructions"}
	if err := EnsureClaudeCodeSystem(request); err != nil {
		t.Fatalf("EnsureClaudeCodeSystem() error = %v", err)
	}

	blocks, ok := request.System.([]any)
	if !ok || len(blocks) != 2 {
		t.Fatalf("system = %#v, want two text blocks", request.System)
	}
	first, ok := blocks[0].(map[string]any)
	if !ok || first["text"] != oauth.ClaudeCodeSystemPrompt {
		t.Fatalf("first block = %#v, want Claude Code identity", blocks[0])
	}
}

func TestEnsureClaudeCodeSystemIsIdempotent(t *testing.T) {
	request := &dto.ClaudeRequest{System: []any{
		map[string]any{"type": "text", "text": oauth.ClaudeCodeSystemPrompt},
	}}
	if err := EnsureClaudeCodeSystem(request); err != nil {
		t.Fatalf("first EnsureClaudeCodeSystem() error = %v", err)
	}
	blocks := request.System.([]any)
	if len(blocks) != 1 {
		t.Fatalf("system length = %d, want 1", len(blocks))
	}
}
