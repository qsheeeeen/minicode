package storage

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"minicode/internal/domain"
)

// SessionData is the persisted state of an agent session.
type SessionData struct {
	Model       string                `json:"model"`
	Messages    []domain.MessageParam `json:"messages"`
	TotalTokens int                   `json:"totalTokens"`
}

// SessionInfo contains metadata for a saved session.
type SessionInfo struct {
	Name      string    `json:"name"`
	Timestamp time.Time `json:"timestamp"`
}

// SessionManager handles session persistence in ~/.minicode/sessions.
type SessionManager struct {
	dir string
}

// NewSessionManager creates a session manager.
func NewSessionManager() *SessionManager {
	home, err := os.UserHomeDir()
	dir := ""
	if err == nil {
		dir = filepath.Join(home, ".minicode", "sessions")
	}
	return &SessionManager{dir: dir}
}

// Save persists session data to a JSON file.
func (s *SessionManager) Save(name string, data *SessionData) error {
	if s.dir == "" {
		return nil
	}
	if err := os.MkdirAll(s.dir, 0o755); err != nil {
		return err
	}
	path := filepath.Join(s.dir, name+".json")
	file, err := os.Create(path)
	if err != nil {
		return err
	}
	defer file.Close()
	return json.NewEncoder(file).Encode(data)
}

// Get restores session data from a JSON file.
func (s *SessionManager) Get(name string) (*SessionData, error) {
	if s.dir == "" {
		return nil, errors.New("session directory not found")
	}
	path := filepath.Join(s.dir, name+".json")
	file, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer file.Close()
	var data SessionData
	if err := json.NewDecoder(file).Decode(&data); err != nil {
		return nil, err
	}
	return &data, nil
}

// List returns all saved sessions, sorted by most recent first.
func (s *SessionManager) List() []SessionInfo {
	if s.dir == "" {
		return nil
	}
	entries, err := os.ReadDir(s.dir)
	if err != nil {
		return nil
	}
	var out []SessionInfo
	for _, e := range entries {
		if !e.IsDir() && filepath.Ext(e.Name()) == ".json" {
			info, err := e.Info()
			if err == nil {
				out = append(out, SessionInfo{
					Name:      strings.TrimSuffix(e.Name(), ".json"),
					Timestamp: info.ModTime(),
				})
			}
		}
	}
	sort.Slice(out, func(i, j int) bool {
		return out[i].Timestamp.After(out[j].Timestamp)
	})
	return out
}

// MostRecent returns the name of the latest saved session.
func (s *SessionManager) MostRecent() (string, error) {
	list := s.List()
	if len(list) == 0 {
		return "", errors.New("no sessions found")
	}
	return list[0].Name, nil
}

// Rename renames a session file.
func (s *SessionManager) Rename(oldName, newName string) error {
	if s.dir == "" {
		return nil
	}
	oldPath := filepath.Join(s.dir, oldName+".json")
	newPath := filepath.Join(s.dir, newName+".json")
	return os.Rename(oldPath, newPath)
}
