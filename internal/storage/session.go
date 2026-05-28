package storage

import (
	"bufio"
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

// NewSessionManager creates a session manager scoped to the current project.
func NewSessionManager() *SessionManager {
	home, err := os.UserHomeDir()
	dir := ""
	if err == nil {
		dir = filepath.Join(home, ".minicode", "sessions", log.ProjectHash())
	}
	return &SessionManager{dir: dir, logger: log.Get()}
}

func (s *SessionManager) log(msg string, attrs ...any) {
	s.logger.Info(msg, attrs...)
}

func (s *SessionManager) sessionPath(name string) string {
	return filepath.Join(s.dir, name+".context.jsonl")
}

// sessionHeader is the first line of a JSONL session file.
type sessionHeader struct {
	Model       string `json:"model"`
	TotalTokens int    `json:"totalTokens"`
	MsgCount    int    `json:"msgCount"`
}

// Save persists session data as a JSONL file (full rewrite).
func (s *SessionManager) Save(name string, data *SessionData) error {
	if s.dir == "" {
		return nil
	}
	if err := os.MkdirAll(s.dir, 0o755); err != nil {
		s.log("save failed: mkdir", "session", name, "error", err)
		return err
	}
	path := s.sessionPath(name)
	tmp := path + ".tmp"
	file, err := os.Create(tmp)
	if err != nil {
		s.log("save failed: create file", "session", name, "path", tmp, "error", err)
		return err
	}
	w := bufio.NewWriter(file)
	// Header line
	hdr := sessionHeader{Model: data.Model, TotalTokens: data.TotalTokens, MsgCount: len(data.Messages)}
	hdrBytes, _ := json.Marshal(hdr)
	w.Write(hdrBytes)
	w.WriteByte('\n')
	// Message lines
	for _, msg := range data.Messages {
		line, _ := json.Marshal(msg)
		w.Write(line)
		w.WriteByte('\n')
	}
	if err := w.Flush(); err != nil {
		file.Close()
		os.Remove(tmp)
		s.log("save failed: flush", "session", name, "error", err)
		return err
	}
	file.Close()
	if err := os.Rename(tmp, path); err != nil {
		os.Remove(tmp)
		s.log("save failed: rename", "session", name, "error", err)
		return err
	}
	s.log("session saved", "session", name, "turns", len(data.Messages), "tokens", data.TotalTokens)
	return nil
}

// Get restores session data from a JSONL file.
func (s *SessionManager) Get(name string) (*SessionData, error) {
	if s.dir == "" {
		s.log("get failed: no session directory", "session", name)
		return nil, errors.New("session directory not found")
	}
	path := s.sessionPath(name)
	file, err := os.Open(path)
	if err != nil {
		s.log("get failed: open file", "session", name, "path", path, "error", err)
		return nil, err
	}
	defer file.Close()

	scanner := bufio.NewScanner(file)
	scanner.Buffer(make([]byte, 0, 1024*1024), 1024*1024) // 1MB max line

	// First line: header
	if !scanner.Scan() {
		s.log("get failed: empty file", "session", name)
		return nil, errors.New("empty session file")
	}
	var hdr sessionHeader
	if err := json.Unmarshal(scanner.Bytes(), &hdr); err != nil {
		s.log("get failed: decode header", "session", name, "error", err)
		return nil, err
	}

	// Remaining lines: messages
	var messages []domain.MessageParam
	for scanner.Scan() {
		var msg domain.MessageParam
		if err := json.Unmarshal(scanner.Bytes(), &msg); err != nil {
			s.log("get: skipping malformed line", "session", name, "error", err)
			continue
		}
		messages = append(messages, msg)
	}
	if err := scanner.Err(); err != nil {
		s.log("get failed: scan error", "session", name, "error", err)
		return nil, err
	}

	data := &SessionData{
		Model:       hdr.Model,
		Messages:    messages,
		TotalTokens: hdr.TotalTokens,
	}
	s.log("session loaded", "session", name, "turns", len(messages), "tokens", hdr.TotalTokens)
	return data, nil
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
		if !e.IsDir() && strings.HasSuffix(e.Name(), ".context.jsonl") {
			info, err := e.Info()
			if err == nil {
				out = append(out, SessionInfo{
					Name:      strings.TrimSuffix(e.Name(), ".context.jsonl"),
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
	oldPath := filepath.Join(s.dir, oldName+".context.jsonl")
	newPath := filepath.Join(s.dir, newName+".context.jsonl")
	return os.Rename(oldPath, newPath)
}
