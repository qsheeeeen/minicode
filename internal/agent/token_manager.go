package agent

import (
	"sync"
)

// TokenManager tracks token consumption and threshold triggers.
type TokenManager struct {
	mu            sync.RWMutex
	input         int
	output        int
	cacheCreation int
	cacheRead     int
	lastThreshold int
}

// NewTokenManager creates a new token manager.
func NewTokenManager() *TokenManager {
	return &TokenManager{}
}

// Add adds tokens to the manager.
func (m *TokenManager) Add(input, output, cacheCreation, cacheRead int) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.input += input
	m.output += output
	m.cacheCreation += cacheCreation
	m.cacheRead += cacheRead
}

// Total returns the total combined token count.
func (m *TokenManager) Total() int {
	m.mu.RLock()
	defer m.mu.RUnlock()
	return m.input + m.output + m.cacheCreation + m.cacheRead
}

// Reset clears all token counts.
func (m *TokenManager) Reset() {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.input = 0
	m.output = 0
	m.cacheCreation = 0
	m.cacheRead = 0
	m.lastThreshold = 0
}

// Ratio returns the current token consumption ratio relative to context length.
func (m *TokenManager) Ratio(contextLength int) float64 {
	if contextLength == 0 {
		return 0
	}
	return float64(m.Total()) / float64(contextLength)
}

// ShouldCompress returns true if consumption exceeds the threshold.
func (m *TokenManager) ShouldCompress(contextLength int, thresholdRatio float64) bool {
	if contextLength == 0 || thresholdRatio == 0 {
		return false
	}
	return m.Ratio(contextLength) >= thresholdRatio
}

// LastShownThreshold returns the last reported percentage threshold.
func (m *TokenManager) LastShownThreshold() int {
	m.mu.RLock()
	defer m.mu.RUnlock()
	return m.lastThreshold
}

// SetLastShownThreshold sets the reported threshold.
func (m *TokenManager) SetLastShownThreshold(t int) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.lastThreshold = t
}
