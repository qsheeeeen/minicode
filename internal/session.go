package internal

import (
	"crypto/md5"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"time"
)

// SessionData contains the serialisable session state.
type SessionData struct {
	Model       string `json:"model"`
	Messages    []any  `json:"messages"`
	TotalTokens int    `json:"totalTokens"`
	CreatedAt   string `json:"createdAt"`
	UpdatedAt   string `json:"updatedAt"`
}

// SessionInfo is summary metadata for a saved session.
type SessionInfo struct {
	Name      string
	UpdatedAt string
}

// SessionManager persists sessions to ~/.minicode/sessions/<projectHash>/.
type SessionManager struct {
	sessionsDir string
}

// NewSessionManager creates a session manager for the current working directory.
func NewSessionManager() *SessionManager {
	cwd, _ := os.Getwd()
	hash := fmt.Sprintf("%x", md5.Sum([]byte(cwd)))[:12]
	home, _ := os.UserHomeDir()
	return &SessionManager{
		sessionsDir: filepath.Join(home, ".minicode", "sessions", hash),
	}
}

func (m *SessionManager) ensureDir() error { return os.MkdirAll(m.sessionsDir, 0o755) }

// List returns all saved sessions sorted by update time (newest first).
func (m *SessionManager) List() ([]SessionInfo, error) {
	_ = m.ensureDir()
	entries, err := os.ReadDir(m.sessionsDir)
	if err != nil {
		return nil, nil
	}
	var sessions []SessionInfo
	for _, e := range entries {
		if filepath.Ext(e.Name()) != ".json" {
			continue
		}
		name := e.Name()[:len(e.Name())-5]
		data, err := m.Get(name)
		if err == nil && data != nil {
			sessions = append(sessions, SessionInfo{Name: name, UpdatedAt: data.UpdatedAt})
		}
	}
	sort.Slice(sessions, func(i, j int) bool { return sessions[i].UpdatedAt > sessions[j].UpdatedAt })
	return sessions, nil
}

// MostRecent returns the name of the most recently updated session.
func (m *SessionManager) MostRecent() (string, error) {
	sessions, err := m.List()
	if err != nil || len(sessions) == 0 {
		return "", err
	}
	return sessions[0].Name, nil
}

// Get loads a named session.
func (m *SessionManager) Get(name string) (*SessionData, error) {
	_ = m.ensureDir()
	b, err := os.ReadFile(filepath.Join(m.sessionsDir, name+".json"))
	if err != nil {
		return nil, err
	}
	var data SessionData
	if err := json.Unmarshal(b, &data); err != nil {
		return nil, err
	}
	return &data, nil
}

// Save persists session data.
func (m *SessionManager) Save(name string, data *SessionData) error {
	_ = m.ensureDir()
	now := time.Now().Format(time.RFC3339)
	data.UpdatedAt = now
	if data.CreatedAt == "" {
		data.CreatedAt = now
	}
	b, err := json.MarshalIndent(data, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(filepath.Join(m.sessionsDir, name+".json"), b, 0o644)
}

// Delete removes a saved session.
func (m *SessionManager) Delete(name string) error {
	_ = m.ensureDir()
	return os.Remove(filepath.Join(m.sessionsDir, name+".json"))
}

// Rename renames a session file.
func (m *SessionManager) Rename(oldName, newName string) error {
	_ = m.ensureDir()
	return os.Rename(
		filepath.Join(m.sessionsDir, oldName+".json"),
		filepath.Join(m.sessionsDir, newName+".json"),
	)
}
