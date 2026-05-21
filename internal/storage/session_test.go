package storage

import (
	"os"
	"testing"

	"minicode/internal/domain"
)

func TestSessionManager_SaveAndGet(t *testing.T) {
	tmpDir, _ := os.MkdirTemp("", "session-test")
	defer os.RemoveAll(tmpDir)

	sm := &SessionManager{dir: tmpDir}
	data := &SessionData{
		Model:       "test-model",
		Messages:    []domain.MessageParam{{Role: "user", Content: "hello"}},
		TotalTokens: 100,
	}

	if err := sm.Save("test-session", data); err != nil {
		t.Fatal(err)
	}

	loaded, err := sm.Get("test-session")
	if err != nil {
		t.Fatal(err)
	}

	if loaded.Model != "test-model" {
		t.Errorf("expected test-model, got %s", loaded.Model)
	}
}
