package service

import (
	"testing"
	"time"
)

func TestResolveCleanupCutoffsUsesOneDayRequestTraceRetention(t *testing.T) {
	now := time.Unix(1_700_000_000, 0)
	logAndTaskCutoff, requestTraceCutoff := resolveCleanupCutoffs(now)

	if want := now.Add(-72 * time.Hour).Unix(); logAndTaskCutoff != want {
		t.Fatalf("log/task cutoff = %d, want %d", logAndTaskCutoff, want)
	}
	if want := now.Add(-24 * time.Hour).Unix(); requestTraceCutoff != want {
		t.Fatalf("request trace cutoff = %d, want %d", requestTraceCutoff, want)
	}
}
