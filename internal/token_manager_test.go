package internal

import "testing"

func TestTokenManager_AddSumInputOutput(t *testing.T) {
	tm := NewTokenManager()
	tm.Add(1000, 200, 0, 0)
	if tm.Total() != 1200 {
		t.Errorf("expected 1200, got %d", tm.Total())
	}
}

func TestTokenManager_AddIncludesCacheCreation(t *testing.T) {
	tm := NewTokenManager()
	tm.Add(1000, 200, 500, 0)
	if tm.Total() != 1700 {
		t.Errorf("expected 1700, got %d", tm.Total())
	}
}

func TestTokenManager_AddIncludesCacheRead(t *testing.T) {
	tm := NewTokenManager()
	tm.Add(1000, 200, 0, 300)
	if tm.Total() != 1500 {
		t.Errorf("expected 1500, got %d", tm.Total())
	}
}

func TestTokenManager_AddSumsAllTypes(t *testing.T) {
	tm := NewTokenManager()
	tm.Add(1000, 200, 500, 300)
	if tm.Total() != 2000 {
		t.Errorf("expected 2000, got %d", tm.Total())
	}
}

func TestTokenManager_AddOverwritesPrevious(t *testing.T) {
	tm := NewTokenManager()
	tm.Add(100, 200, 0, 0) // total = 300
	tm.Add(400, 200, 0, 0) // total = 600 (overwrites, doesn't accumulate)
	if tm.Total() != 600 {
		t.Errorf("expected 600 (overwrite), got %d", tm.Total())
	}
}

func TestTokenManager_Ratio(t *testing.T) {
	tm := NewTokenManager()
	tm.Add(50000, 0, 0, 0)
	ratio := tm.Ratio(100000)
	if ratio != 0.5 {
		t.Errorf("expected 0.5, got %f", ratio)
	}
}

func TestTokenManager_RatioZeroWhenNoTokens(t *testing.T) {
	tm := NewTokenManager()
	if tm.Ratio(100000) != 0 {
		t.Error("expected 0 when no tokens")
	}
}

func TestTokenManager_RatioZeroContextLength(t *testing.T) {
	tm := NewTokenManager()
	tm.Add(100, 0, 0, 0)
	if tm.Ratio(0) != 0 {
		t.Error("expected 0 when context length is 0")
	}
}

func TestTokenManager_ShouldCompressAbove(t *testing.T) {
	tm := NewTokenManager()
	tm.Add(85000, 0, 0, 0)
	if !tm.ShouldCompress(100000, 0.8) {
		t.Error("expected true when above threshold")
	}
}

func TestTokenManager_ShouldCompressAtThreshold(t *testing.T) {
	tm := NewTokenManager()
	tm.Add(80000, 0, 0, 0)
	if tm.ShouldCompress(100000, 0.8) {
		t.Error("expected false when at threshold (not above)")
	}
}

func TestTokenManager_ShouldCompressBelowThreshold(t *testing.T) {
	tm := NewTokenManager()
	tm.Add(70000, 0, 0, 0)
	if tm.ShouldCompress(100000, 0.8) {
		t.Error("expected false when below threshold")
	}
}

func TestTokenManager_ShouldCompressBoundary(t *testing.T) {
	// 74999 with threshold 0.75: 75000 is threshold, 74999 <= 75000 = false
	tm := NewTokenManager()
	tm.Add(74999, 0, 0, 0)
	if tm.ShouldCompress(100000, 0.75) {
		t.Error("expected false at boundary below")
	}
	// 75001 > 75000 = true
	tm2 := NewTokenManager()
	tm2.Add(75001, 0, 0, 0)
	if !tm2.ShouldCompress(100000, 0.75) {
		t.Error("expected true at boundary above")
	}
}

func TestTokenManager_LastShownThreshold(t *testing.T) {
	tm := NewTokenManager()
	if tm.LastShownThreshold() != 0 {
		t.Error("expected initial 0")
	}
	tm.SetLastShownThreshold(75)
	if tm.LastShownThreshold() != 75 {
		t.Error("expected 75 after set")
	}
}

func TestTokenManager_MultipleSetOverwrites(t *testing.T) {
	tm := NewTokenManager()
	tm.SetLastShownThreshold(70)
	tm.SetLastShownThreshold(80)
	if tm.LastShownThreshold() != 80 {
		t.Error("expected last set value")
	}
}

func TestTokenManager_ResetClearsTotal(t *testing.T) {
	tm := NewTokenManager()
	tm.Add(100, 0, 0, 0)
	tm.Reset()
	if tm.Total() != 0 {
		t.Error("expected 0 after reset")
	}
}

func TestTokenManager_ResetClearsThreshold(t *testing.T) {
	tm := NewTokenManager()
	tm.SetLastShownThreshold(80)
	tm.Reset()
	if tm.LastShownThreshold() != 0 {
		t.Error("expected 0 after reset")
	}
}
