package service

import (
	"net/http"
	"testing"

	"github.com/QuantumNous/new-api/types"
	"github.com/stretchr/testify/require"
)

func TestIsRetryableTransientUpstreamError(t *testing.T) {
	t.Parallel()

	testCases := []struct {
		name     string
		err      *types.NewAPIError
		expected bool
	}{
		{
			name: "matches upstream busy message wrapped as invalid request",
			err: types.WithOpenAIError(types.OpenAIError{
				Message: "系统繁忙，请稍后再试（traceid: 9ff64288438ab0187d636b1f1cf7d62e）",
				Type:    "invalid_request_error",
			}, http.StatusBadRequest),
			expected: true,
		},
		{
			name: "matches english temporary overload",
			err: types.WithOpenAIError(types.OpenAIError{
				Message: "upstream overloaded, try again later",
				Type:    "invalid_request_error",
			}, http.StatusBadRequest),
			expected: true,
		},
		{
			name: "does not match real request validation error",
			err: types.WithOpenAIError(types.OpenAIError{
				Message: "Invalid value for size: expected one of 1024x1024, 1536x1024",
				Type:    "invalid_request_error",
			}, http.StatusBadRequest),
			expected: false,
		},
		{
			name:     "nil error",
			err:      nil,
			expected: false,
		},
	}

	for _, tc := range testCases {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			require.Equal(t, tc.expected, IsRetryableTransientUpstreamError(tc.err))
		})
	}
}
