package storage

import (
	"encoding/json"
	"errors"
	"log/slog"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"minicode/internal/domain"
	"minicode/internal/log"
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
	dir    string
	logger *slog.Logger
}

// NewSessionManager creates a session manager.
func NewSessionManager() *SessionManager {
	home, err := os.UserHomeDir()
	dir := ""
	if err == nil {
		dir = filepath.Join(home, ".minicode", "sessions")
	}
	return &SessionManager{dir: dir, logger: log.Get()}
}

func (s *SessionManager) log(msg string, attrs ...any) {
	s.logger.Info(msg, attrs...)
}

// Save persists session data to a JSON file.
func (s *SessionManager) Save(name string, data *SessionData) error {
	if s.dir == "" {
		return nil
	}
	if err := os.MkdirAll(s.dir, 0o755); err != nil {
		s.log("save failed: mkdir", "session", name, "error", err)
		return err
	}
	path := filepath.Join(s.dir, name+".context.json")
	file, err := os.Create(path)
	if err != nil {
		s.log("save failed: create file", "session", name, "path", path, "error", err)
		return err
	}
	defer file.Close()
	if err := json.NewEncoder(file).Encode(data); err != nil {
		s.log("save failed: encode", "session", name, "error", err)
		return err
	}
	s.log("session saved", "session", name, "turns", len(data.Messages), "tokens", data.TotalTokens)
	return nil
}

// Get restores session data from a JSON file.
func (s *SessionManager) Get(name string) (*SessionData, error) {
	if s.dir == "" {
		s.log("get failed: no session directory", "session", name)
		return nil, errors.New("session directory not found")
	}
	path := filepath.Join(s.dir, name+".context.json")
	file, err := os.Open(path)
	if err != nil {
		s.log("get failed: open file", "session", name, "path", path, "error", err)
		return nil, err
	}
	defer file.Close()
	var data SessionData
	if err := json.NewDecoder(file).Decode(&data); err != nil {
		s.log("get failed: decode", "session", name, "error", err)
		return nil, err
	}
	s.log("session loaded", "session", name, "turns", len(data.Messages), "tokens", data.TotalTokens)
	return &data, nil
}

// List returns all saved sessions, sorted by most recent first.
func (s *SessionManager) List() []SessionInfo {
	if s.dir == "" {
		return nil
	}
	entries, err := os.ReadDir(s.dir)
	if err != nil {
		s.log("list failed", "error", err)
		return nil
	}
	var out []SessionInfo
	for _, e := range entries {
		if !e.IsDir() && filepath.Ext(e.Name()) == ".context.json" {
			info, err := e.Info()
			if err == nil {
				out = append(out, SessionInfo{
					Name:      strings.TrimSuffix(e.Name(), ".context.json"),
					Timestamp: info.ModTime(),
				})
			}
		}
	}
	sort.Slice(out, func(i, j int) bool {
		return out[i].Timestamp.After(out[j].Timestamp)
	})
	s.log("session list", "count", len(out))
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
	oldPath := filepath.Join(s.dir, oldName+".context.json")
	newPath := filepath.Join(s.dir, newName+".context.json")
	return os.Rename(oldPath, newPath)
}
