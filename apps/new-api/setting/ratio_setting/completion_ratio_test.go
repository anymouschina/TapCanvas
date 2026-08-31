package ratio_setting

import "testing"

func isolateCompletionRatioMap(t *testing.T) {
	t.Helper()
	original := completionRatioMap.ReadAll()
	completionRatioMap.Clear()
	t.Cleanup(func() {
		completionRatioMap.Clear()
		completionRatioMap.AddAll(original)
	})
}

func TestCompletionRatioUsesFamilyDefaultWhenExactPriceIsMissing(t *testing.T) {
	isolateCompletionRatioMap(t)

	if ratio := GetCompletionRatio("gpt-5.6-luna"); ratio != 8 {
		t.Fatalf("family default ratio = %g, want 8", ratio)
	}
	info := GetCompletionRatioInfo("gpt-5.6-luna")
	if !info.Locked || info.Ratio != 8 {
		t.Fatalf("unexpected family default info: %+v", info)
	}
}

func TestCompletionRatioPrefersExactPersistedPrice(t *testing.T) {
	isolateCompletionRatioMap(t)
	completionRatioMap.Set("gpt-5.6-luna", 6)

	if ratio := GetCompletionRatio("gpt-5.6-luna"); ratio != 6 {
		t.Fatalf("exact persisted ratio = %g, want 6", ratio)
	}
	info := GetCompletionRatioInfo("gpt-5.6-luna")
	if info.Locked || info.Ratio != 6 {
		t.Fatalf("unexpected exact persisted info: %+v", info)
	}
}
