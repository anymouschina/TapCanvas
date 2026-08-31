package relay

import (
	"strings"
	"testing"
)

func TestResponseTraceRecorderBoundsStoredBody(t *testing.T) {
	recorder := &responseTraceRecorder{}
	payload := strings.Repeat("x", maxResponseTraceBytes+1024)

	written, err := recorder.Write([]byte(payload))

	if err != nil {
		t.Fatalf("unexpected write error: %v", err)
	}
	if written != len(payload) {
		t.Fatalf("tee writer must report the full input length: got %d, want %d", written, len(payload))
	}
	if len(recorder.data) != maxResponseTraceBytes {
		t.Fatalf("stored trace length = %d, want %d", len(recorder.data), maxResponseTraceBytes)
	}
	if !strings.Contains(recorder.body(), "upstream response trace truncated") {
		t.Fatalf("expected truncation marker, got %q", recorder.body()[len(recorder.body())-80:])
	}
}
