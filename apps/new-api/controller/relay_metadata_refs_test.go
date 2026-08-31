package controller

import (
	"testing"

	"github.com/stretchr/testify/require"
)

// 续写镜的参考图被 hono 塞进 metadata.content（绕过 req.Images），任务日志「入参」必须
// 把这些 image_url 也提取出来，否则参考图在控制台展示为空。
func TestExtractReferenceImageUrlsFromMetadataContent(t *testing.T) {
	t.Parallel()

	t.Run("both formats and skips video_url", func(t *testing.T) {
		metadata := map[string]any{
			"content": []any{
				map[string]any{
					"type":      "image_url",
					"image_url": map[string]any{"url": "https://cdn.example.com/a.png"},
				},
				map[string]any{
					"type":      "video_url",
					"video_url": map[string]any{"url": "https://cdn.example.com/clip.mp4"},
				},
				// {"image_url":"..."} 简写格式
				map[string]any{"image_url": "https://cdn.example.com/b.png"},
			},
		}
		got := extractReferenceImageUrlsFromMetadataContent(metadata)
		require.Equal(t, []string{
			"https://cdn.example.com/a.png",
			"https://cdn.example.com/b.png",
		}, got)
	})

	t.Run("nil and empty are no-ops", func(t *testing.T) {
		require.Empty(t, extractReferenceImageUrlsFromMetadataContent(nil))
		require.Empty(t, extractReferenceImageUrlsFromMetadataContent(map[string]any{}))
		require.Empty(t, extractReferenceImageUrlsFromMetadataContent(map[string]any{"content": []any{}}))
	})
}
