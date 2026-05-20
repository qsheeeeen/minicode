package internal

// TokenManager tracks token usage and compression thresholds.
type TokenManager struct {
	totalTokens        int
	lastShownThreshold int
}

// NewTokenManager creates a new token manager.
func NewTokenManager() *TokenManager { return &TokenManager{} }

// Add updates the total token count. Input includes cache tokens.
func (tm *TokenManager) Add(input, output, cacheCreation, cacheRead int) {
	tm.totalTokens = input + output + cacheCreation + cacheRead
}

// Total returns the total token count.
func (tm *TokenManager) Total() int { return tm.totalTokens }

// Ratio returns the fraction of context used.
func (tm *TokenManager) Ratio(contextLength int) float64 {
	if contextLength == 0 {
		return 0
	}
	return float64(tm.totalTokens) / float64(contextLength)
}

// ShouldCompress returns true when tokens exceed threshold ratio.
func (tm *TokenManager) ShouldCompress(contextLength int, thresholdRatio float64) bool {
	threshold := int(float64(contextLength) * thresholdRatio)
	return tm.totalTokens > threshold
}

// LastShownThreshold returns the last recorded percentage threshold.
func (tm *TokenManager) LastShownThreshold() int { return tm.lastShownThreshold }

// SetLastShownThreshold updates the last shown threshold.
func (tm *TokenManager) SetLastShownThreshold(v int) { tm.lastShownThreshold = v }

// Reset clears all counters.
func (tm *TokenManager) Reset() {
	tm.totalTokens = 0
	tm.lastShownThreshold = 0
}
