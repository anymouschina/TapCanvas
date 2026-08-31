package service

import (
	"testing"
	"time"
)

func TestParseCodexUsageSnapshotUsesMostConstrainedWindow(t *testing.T) {
	now := time.Unix(1_700_000_000, 0)
	usage, err := parseCodexUsageSnapshot([]byte(`{
		"plan_type":"team",
		"rate_limit":{"allowed":true,"limit_reached":false,
		"primary_window":{"used_percent":96,"reset_at":1700001000},
		"secondary_window":{"used_percent":40,"reset_at":1700100000}}
	}`), now)
	if err != nil {
		t.Fatalf("parse error: %v", err)
	}
	if usage.UsedPercent != 96 || usage.RemainingPercent != 4 {
		t.Fatalf("usage = %#v", usage)
	}
	if got := codexUsageCooldownUntil(usage, now.Unix()); got != 1_700_001_060 {
		t.Fatalf("cooldown until = %d", got)
	}
}

func TestCodexUsageCooldownUsesLaterConstrainedReset(t *testing.T) {
	now := time.Unix(1_700_000_000, 0)
	usage, err := parseCodexUsageSnapshot([]byte(`{
		"rate_limit":{"allowed":false,"limit_reached":true,
		"primary_window":{"used_percent":100,"reset_at":1700001000},
		"secondary_window":{"used_percent":98,"reset_at":1700100000}}
	}`), now)
	if err != nil {
		t.Fatalf("parse error: %v", err)
	}
	if got := codexUsageCooldownUntil(usage, now.Unix()); got != 1_700_100_060 {
		t.Fatalf("cooldown until = %d", got)
	}
}

func TestParseCodexUsageSnapshotRejectsInvalidPercent(t *testing.T) {
	_, err := parseCodexUsageSnapshot([]byte(`{"rate_limit":{"primary_window":{"used_percent":101}}}`), time.Now())
	if err == nil {
		t.Fatal("invalid percent error = nil")
	}
}

func TestCodexAccountRemovalRemapsLifecycleState(t *testing.T) {
	indexes := map[int]int{0: 0, 2: 1}
	if got := remapIntMap(map[int]int{1: 3, 2: 2}, indexes); len(got) != 1 || got[1] != 2 {
		t.Fatalf("status remap = %#v", got)
	}
	if got := remapStringMap(map[int]string{0: "a", 1: "removed", 2: "c"}, indexes); got[0] != "a" || got[1] != "c" || len(got) != 2 {
		t.Fatalf("reason remap = %#v", got)
	}
}
