// Package session handles persistence of conversation sessions to disk.
package session

import (
	"crypto/md5"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"time"
)

// Data contains the serialisable session state.
type Data struct {
	Model       string `json:"model"`
	Messages    []any  `json:"messages"`
	TotalTokens int    `json:"totalTokens"`
	CreatedAt   string `json:"createdAt"`
	UpdatedAt   string `json:"updatedAt"`
}

// Info is summary metadata for a saved session.
type Info struct {
	Name      string
	UpdatedAt string
}

// Manager persists sessions to ~/.minicode/sessions/<projectHash>/.
type Manager struct {
	sessionsDir string
}

// NewManager creates a session manager for the current working directory.
func NewManager() *Manager {
	cwd, _ := os.Getwd()
	hash := fmt.Sprintf("%x", md5.Sum([]byte(cwd)))[:12]
	home, _ := os.UserHomeDir()
	return &Manager{
		sessionsDir: filepath.Join(home, ".minicode", "sessions", hash),
	}
}

func (m *Manager) ensureDir() error {
	return os.MkdirAll(m.sessionsDir, 0o755)
}

// List returns all saved sessions sorted by update time (newest first).
func (m *Manager) List() ([]Info, error) {
	_ = m.ensureDir()
	entries, err := os.ReadDir(m.sessionsDir)
	if err != nil {
		return nil, nil
	}

	var sessions []Info
	for _, e := range entries {
		if filepath.Ext(e.Name()) != ".json" {
			continue
		}
		name := e.Name()[:len(e.Name())-5]
		data, err := m.Get(name)
		if err == nil && data != nil {
			sessions = append(sessions, Info{Name: name, UpdatedAt: data.UpdatedAt})
		}
	}
	sort.Slice(sessions, func(i, j int) bool {
		return sessions[i].UpdatedAt > sessions[j].UpdatedAt
	})
	return sessions, nil
}

// MostRecent returns the name of the most recently updated session.
func (m *Manager) MostRecent() (string, error) {
	sessions, err := m.List()
	if err != nil || len(sessions) == 0 {
		return "", err
	}
	return sessions[0].Name, nil
}

// Get loads a named session.
func (m *Manager) Get(name string) (*Data, error) {
	_ = m.ensureDir()
	path := filepath.Join(m.sessionsDir, name+".json")
	b, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	var data Data
	if err := json.Unmarshal(b, &data); err != nil {
		return nil, err
	}
	return &data, nil
}

// Save persists session data.
func (m *Manager) Save(name string, data *Data) error {
	_ = m.ensureDir()
	now := time.Now().Format(time.RFC3339)
	data.UpdatedAt = now
	if data.CreatedAt == "" {
		data.CreatedAt = now
	}
	path := filepath.Join(m.sessionsDir, name+".json")
	b, err := json.MarshalIndent(data, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(path, b, 0o644)
}

// Delete removes a saved session.
func (m *Manager) Delete(name string) error {
	_ = m.ensureDir()
	return os.Remove(filepath.Join(m.sessionsDir, name+".json"))
}

// Rename renames a session file.
func (m *Manager) Rename(oldName, newName string) error {
	_ = m.ensureDir()
	oldPath := filepath.Join(m.sessionsDir, oldName+".json")
	newPath := filepath.Join(m.sessionsDir, newName+".json")
	return os.Rename(oldPath, newPath)
}
