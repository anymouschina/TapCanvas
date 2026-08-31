package service

import (
	"testing"

	"github.com/QuantumNous/new-api/constant"
	"github.com/stretchr/testify/require"
)

func TestShouldChatCompletionsUseResponsesForUpstreamUsesProtocol(t *testing.T) {
	require.True(
		t,
		ShouldChatCompletionsUseResponsesForUpstream(constant.ProtocolRightCode, "gpt-5.1"),
	)
	require.False(
		t,
		ShouldChatCompletionsUseResponsesForUpstream(constant.ProtocolOpenAI, "gpt-5.1"),
	)
	require.False(
		t,
		ShouldChatCompletionsUseResponsesForUpstream(constant.ProtocolRightCode, "claude-sonnet-4"),
	)
}
