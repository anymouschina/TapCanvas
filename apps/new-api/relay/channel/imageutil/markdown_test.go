package imageutil

import (
	"testing"

	"github.com/stretchr/testify/require"
)

func TestNormalizeHTTPImageURL(t *testing.T) {
	t.Parallel()

	imageURL, ok := NormalizeHTTPImageURL("  HTTPS://assets.example.com/image.jpg?token=abc  ")
	require.True(t, ok)
	require.Equal(t, "HTTPS://assets.example.com/image.jpg?token=abc", imageURL)

	_, ok = NormalizeHTTPImageURL("https://user:password@assets.example.com/image.jpg")
	require.False(t, ok)

	_, ok = NormalizeHTTPImageURL("/generated/image.jpg")
	require.False(t, ok)
}
