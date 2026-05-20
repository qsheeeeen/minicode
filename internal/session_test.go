package internal

import (
	"os"
	"path/filepath"
	"testing"
)

func TestSessionManager_SaveAndGet(t *testing.T) {
	sm := NewSessionManager()
	name := "test-session-" + t.Name()

	data := &SessionData{
		Model:       "claude-test",
		Messages:    []any{map[string]any{"role": "user", "content": "hello"}},
		TotalTokens: 42,
	}

	err := sm.Save(name, data)
	if err != nil {
		t.Fatalf("save failed: %s", err)
	}
	defer sm.Delete(name)

	loaded, err := sm.Get(name)
	if err != nil {
		t.Fatalf("get failed: %s", err)
	}
	if loaded.Model != "claude-test" {
		t.Errorf("model mismatch: got %s", loaded.Model)
	}
	if loaded.TotalTokens != 42 {
		t.Errorf("tokens mismatch: got %d", loaded.TotalTokens)
	}
	if loaded.CreatedAt == "" || loaded.UpdatedAt == "" {
		t.Error("timestamps should be set")
	}
}

func TestSessionManager_GetMissing(t *testing.T) {
	sm := NewSessionManager()
	_, err := sm.Get("nonexistent-session")
	if err == nil {
		t.Error("expected error for missing session")
	}
}

func TestSessionManager_List(t *testing.T) {
	sm := NewSessionManager()
	name := "test-list-" + t.Name()

	_ = sm.Save(name, &SessionData{Model: "test"})
	defer sm.Delete(name)

	sessions, err := sm.List()
	if err != nil {
		t.Fatalf("list failed: %s", err)
	}
	found := false
	for _, s := range sessions {
		if s.Name == name {
			found = true
			break
		}
	}
	if !found {
		t.Error("expected to find saved session in list")
	}
}

func TestSessionManager_Rename(t *testing.T) {
	sm := NewSessionManager()
	oldName := "test-rename-old-" + t.Name()
	newName := "test-rename-new-" + t.Name()

	_ = sm.Save(oldName, &SessionData{Model: "test"})
	defer sm.Delete(oldName)
	defer sm.Delete(newName)

	err := sm.Rename(oldName, newName)
	if err != nil {
		t.Fatalf("rename failed: %s", err)
	}

	_, err = sm.Get(oldName)
	if err == nil {
		t.Error("old name should not exist after rename")
	}

	data, err := sm.Get(newName)
	if err != nil {
		t.Error("new name should exist after rename")
	}
	if data != nil && data.Model != "test" {
		t.Error("data should be preserved after rename")
	}
}

func TestSessionManager_SessionsDir(t *testing.T) {
	sm := NewSessionManager()
	home, _ := os.UserHomeDir()
	expectedPrefix := filepath.Join(home, ".minicode", "sessions")
	if len(sm.sessionsDir) < len(expectedPrefix) {
		t.Error("sessions dir should be under ~/.minicode/sessions")
	}
}
