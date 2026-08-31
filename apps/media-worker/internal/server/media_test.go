package server

import (
	"strings"
	"testing"
	"time"

	tapmediav1 "tapcanvas/media-worker/gen/tapmedia/v1"
)

func TestPosterKeyLayoutMatchesHonoApi(t *testing.T) {
	now := time.Date(2026, 7, 6, 12, 0, 0, 0, time.UTC)
	key := PosterKey("user-123", now)
	if !strings.HasPrefix(key, "gen/thumbnails/user-123/20260706/") {
		t.Fatalf("key prefix mismatch: %s", key)
	}
	if !strings.HasSuffix(key, ".jpg") {
		t.Fatalf("key suffix mismatch: %s", key)
	}
}

func TestConcatOutputKeyIsStableAndContractSensitive(t *testing.T) {
	inSec := 0.5
	request := &tapmediav1.ConcatVideosRequest{
		UserId:       "user-123",
		TargetAspect: "9:16",
		Clips: []*tapmediav1.ConcatClip{
			{Url: "https://assets.example/a.mp4"},
			{Url: "https://assets.example/b.mp4", InSec: &inSec},
		},
	}
	first, err := concatOutputKey(request)
	if err != nil {
		t.Fatal(err)
	}
	second, err := concatOutputKey(request)
	if err != nil {
		t.Fatal(err)
	}
	if first != second {
		t.Fatalf("same concat contract must reuse one key: %s != %s", first, second)
	}
	request.TargetAspect = "16:9"
	changed, err := concatOutputKey(request)
	if err != nil {
		t.Fatal(err)
	}
	if first == changed {
		t.Fatalf("different concat contracts must not share a key: %s", first)
	}
}

func TestPosterKeyEscapesUserID(t *testing.T) {
	key := PosterKey("a/b", time.Date(2026, 7, 6, 0, 0, 0, 0, time.UTC))
	// userId 段必须转义,不能把 key 拆出额外目录层级。
	if strings.Contains(key, "/a/b/") {
		t.Fatalf("userId must be escaped: %s", key)
	}
	if !strings.Contains(key, "a%2Fb") {
		t.Fatalf("expected escaped userId in key: %s", key)
	}
}
