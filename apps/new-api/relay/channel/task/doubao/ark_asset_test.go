package doubao

import (
	"errors"
	"reflect"
	"testing"

	"github.com/QuantumNous/new-api/relay/channel/volcengine"
)

func TestRewriteMetadataContentAssetsConvertsImageVideoAndAudio(t *testing.T) {
	image := map[string]interface{}{"url": "https://example.com/image.png"}
	video := map[string]interface{}{"url": "https://example.com/video.mp4"}
	audio := map[string]interface{}{"url": "https://example.com/audio.mp3"}
	metadata := map[string]interface{}{
		"content": []interface{}{
			map[string]interface{}{"type": "text", "text": "prompt"},
			map[string]interface{}{"type": "image_url", "image_url": image},
			map[string]interface{}{"type": "video_url", "video_url": video},
			map[string]interface{}{"type": "audio_url", "audio_url": audio},
		},
	}
	wantInputs := []volcengine.SeedanceAssetInput{
		{URL: "https://example.com/image.png", Type: volcengine.ArkAssetTypeImage},
		{URL: "https://example.com/video.mp4", Type: volcengine.ArkAssetTypeVideo},
		{URL: "https://example.com/audio.mp3", Type: volcengine.ArkAssetTypeAudio},
	}
	changed, err := rewriteMetadataContentAssets(metadata, func(inputs []volcengine.SeedanceAssetInput) ([]string, error) {
		if !reflect.DeepEqual(inputs, wantInputs) {
			t.Fatalf("inputs = %#v, want %#v", inputs, wantInputs)
		}
		return []string{"asset://image", "asset://video", "asset://audio"}, nil
	})
	if err != nil {
		t.Fatalf("rewriteMetadataContentAssets returned error: %v", err)
	}
	if !changed {
		t.Fatal("expected metadata to be changed")
	}
	if image["url"] != "asset://image" || video["url"] != "asset://video" || audio["url"] != "asset://audio" {
		t.Fatalf("unexpected rewritten urls: image=%v video=%v audio=%v", image["url"], video["url"], audio["url"])
	}
}

func TestRewriteMetadataContentAssetsDoesNotPartiallyMutateOnFailure(t *testing.T) {
	image := map[string]interface{}{"url": "https://example.com/image.png"}
	video := map[string]interface{}{"url": "https://example.com/video.mp4"}
	metadata := map[string]interface{}{
		"content": []interface{}{
			map[string]interface{}{"type": "image_url", "image_url": image},
			map[string]interface{}{"type": "video_url", "video_url": video},
		},
	}
	wantErr := errors.New("ARK unavailable")
	changed, err := rewriteMetadataContentAssets(metadata, func([]volcengine.SeedanceAssetInput) ([]string, error) {
		return nil, wantErr
	})
	if changed || !errors.Is(err, wantErr) {
		t.Fatalf("changed=%v err=%v, want changed=false err=%v", changed, err, wantErr)
	}
	if image["url"] != "https://example.com/image.png" || video["url"] != "https://example.com/video.mp4" {
		t.Fatalf("metadata was partially mutated: image=%v video=%v", image["url"], video["url"])
	}
}

func TestRewriteMetadataContentAssetsRejectsMismatchedResults(t *testing.T) {
	image := map[string]interface{}{"url": "https://example.com/image.png"}
	metadata := map[string]interface{}{
		"content": []interface{}{
			map[string]interface{}{"type": "image_url", "image_url": image},
		},
	}
	changed, err := rewriteMetadataContentAssets(metadata, func([]volcengine.SeedanceAssetInput) ([]string, error) {
		return []string{}, nil
	})
	if changed || err == nil {
		t.Fatalf("changed=%v err=%v, want explicit result-count error", changed, err)
	}
	if image["url"] != "https://example.com/image.png" {
		t.Fatalf("metadata mutated despite invalid conversion result: %v", image["url"])
	}
}
