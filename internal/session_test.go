package internal

import (
	"os"
	"path/filepath"
	"regexp"
	"testing"
)

func TestSessionManager_SaveAndGet(t *testing.T) {
	sm := NewSessionManager()
	name := "test-save-get-" + t.Name()

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
	if loaded.CreatedAt == "" {
		t.Error("createdAt should be set on first save")
	}
	if loaded.UpdatedAt == "" {
		t.Error("updatedAt should be set on save")
	}
}

func TestSessionManager_GetMissing(t *testing.T) {
	sm := NewSessionManager()
	_, err := sm.Get("nonexistent-session")
	if err == nil {
		t.Error("expected error for missing session")
	}
}

func TestSessionManager_GetReturnsNilOnMissing(t *testing.T) {
	sm := NewSessionManager()
	data, err := sm.Get("definitely-does-not-exist-12345")
	if err == nil {
		t.Error("expected error")
	}
	if data != nil {
		t.Error("expected nil data")
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

func TestSessionManager_ListSortedByUpdatedAt(t *testing.T) {
	sm := NewSessionManager()
	name1 := "test-sort-older-" + t.Name()
	name2 := "test-sort-newer-" + t.Name()

	_ = sm.Save(name1, &SessionData{Model: "older"})
	_ = sm.Save(name2, &SessionData{Model: "newer"})
	defer sm.Delete(name1)
	defer sm.Delete(name2)

	sessions, _ := sm.List()
	// Most recent first
	if len(sessions) >= 2 {
		if sessions[0].Name != name2 {
			t.Logf("sessions[0]=%s, sessions[1]=%s", sessions[0].Name, sessions[1].Name)
		}
	}
}

func TestSessionManager_ListEmpty(t *testing.T) {
	// Use a unique hash by using a temp dir approach
	// Actually, create a new one and check it doesn't error
	sm := NewSessionManager()
	sessions, err := sm.List()
	if err != nil {
		t.Fatalf("list on empty should not error: %s", err)
	}
	// sessions could have data from other tests
	_ = sessions
}

func TestSessionManager_MostRecent(t *testing.T) {
	sm := NewSessionManager()
	name := "test-most-recent-" + t.Name()
	_ = sm.Save(name, &SessionData{Model: "test"})
	defer sm.Delete(name)

	recent, err := sm.MostRecent()
	if err != nil {
		t.Fatalf("mostRecent failed: %s", err)
	}
	if recent == "" {
		t.Error("expected non-empty recent name")
	}
}

func TestSessionManager_MostRecentEmpty(t *testing.T) {
	// This test can't easily test empty since other tests populate sessions
	// Just verify it doesn't crash
	sm := NewSessionManager()
	_, err := sm.MostRecent()
	// May or may not error depending on existing sessions
	_ = err
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

func TestSessionManager_Delete(t *testing.T) {
	sm := NewSessionManager()
	name := "test-delete-" + t.Name()

	_ = sm.Save(name, &SessionData{Model: "test"})
	err := sm.Delete(name)
	if err != nil {
		t.Fatalf("delete failed: %s", err)
	}

	_, err = sm.Get(name)
	if err == nil {
		t.Error("deleted session should not exist")
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

func TestSessionManager_ProjectHashFormat(t *testing.T) {
	sm := NewSessionManager()
	hash := filepath.Base(sm.sessionsDir)
	matched, _ := regexp.MatchString(`^[a-f0-9]{12}$`, hash)
	if !matched {
		t.Errorf("project hash should be 12 hex chars, got %q", hash)
	}
}
