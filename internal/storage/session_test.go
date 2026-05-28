package storage

import (
	"bufio"
	"log/slog"
	"os"
	"strings"
	"testing"

	"minicode/internal/domain"
)

func TestSessionManager_SaveAndGet(t *testing.T) {
	tmpDir, _ := os.MkdirTemp("", "session-test")
	defer os.RemoveAll(tmpDir)

	sm := &SessionManager{dir: tmpDir, logger: slog.New(slog.NewTextHandler(os.Stderr, nil))}
	data := &SessionData{
		Model:       "test-model",
		Messages:    []domain.MessageParam{{Role: "user", Content: "hello"}},
		TotalTokens: 100,
	}

	if err := sm.Save("test-session", data); err != nil {
		t.Fatal(err)
	}

	// Verify JSONL format: header line + 1 message line
	path := sm.sessionPath("test-session")
	file, err := os.Open(path)
	if err != nil {
		t.Fatal(err)
	}
	defer file.Close()
	scanner := bufio.NewScanner(file)
	lines := 0
	for scanner.Scan() {
		lines++
	}
	if lines != 2 {
		t.Errorf("expected 2 lines (header + 1 message), got %d", lines)
	}

	// Verify round-trip
	loaded, err := sm.Get("test-session")
	if err != nil {
		t.Fatal(err)
	}
	if loaded.Model != "test-model" {
		t.Errorf("expected test-model, got %s", loaded.Model)
	}
	if len(loaded.Messages) != 1 {
		t.Errorf("expected 1 message, got %d", len(loaded.Messages))
	}
	if loaded.Messages[0].Role != "user" {
		t.Errorf("expected user role, got %s", loaded.Messages[0].Role)
	}
}

func TestSessionManager_MultipleMessages(t *testing.T) {
	tmpDir, _ := os.MkdirTemp("", "session-test")
	defer os.RemoveAll(tmpDir)

	sm := &SessionManager{dir: tmpDir, logger: slog.New(slog.NewTextHandler(os.Stderr, nil))}
	data := &SessionData{
		Model: "m1",
		Messages: []domain.MessageParam{
			{Role: "user", Content: "hello"},
			{Role: "assistant", Content: "hi there"},
			{Role: "user", Content: "bye"},
		},
		TotalTokens: 200,
	}

	if err := sm.Save("multi", data); err != nil {
		t.Fatal(err)
	}

	// Verify 4 lines: header + 3 messages
	path := sm.sessionPath("multi")
	file, _ := os.Open(path)
	defer file.Close()
	scanner := bufio.NewScanner(file)
	lines := 0
	for scanner.Scan() {
		lines++
	}
	if lines != 4 {
		t.Errorf("expected 4 lines, got %d", lines)
	}

	loaded, err := sm.Get("multi")
	if err != nil {
		t.Fatal(err)
	}
	if len(loaded.Messages) != 3 {
		t.Errorf("expected 3 messages, got %d", len(loaded.Messages))
	}
	if loaded.TotalTokens != 200 {
		t.Errorf("expected 200 tokens, got %d", loaded.TotalTokens)
	}
}

func TestSessionManager_List(t *testing.T) {
	tmpDir, _ := os.MkdirTemp("", "session-test")
	defer os.RemoveAll(tmpDir)

	sm := &SessionManager{dir: tmpDir, logger: slog.New(slog.NewTextHandler(os.Stderr, nil))}
	data := &SessionData{Model: "m1", Messages: []domain.MessageParam{{Role: "user", Content: "hi"}}}
	sm.Save("session-a", data)
	sm.Save("session-b", data)

	list := sm.List()
	if len(list) != 2 {
		t.Errorf("expected 2 sessions, got %d", len(list))
	}
}

func TestSessionManager_SkipsMalformedLines(t *testing.T) {
	tmpDir, _ := os.MkdirTemp("", "session-test")
	defer os.RemoveAll(tmpDir)

	sm := &SessionManager{dir: tmpDir, logger: slog.New(slog.NewTextHandler(os.Stderr, nil))}

	// Write a file with a valid header, a valid message, and a malformed line
	path := sm.sessionPath("corrupt")
	os.WriteFile(path, []byte(strings.Join([]string{
		`{"model":"m1","totalTokens":0,"msgCount":2}`,
		`{"role":"user","content":"hello"}`,
		`not valid json`,
		`{"role":"assistant","content":"hi"}`,
	}, "\n")+"\n"), 0o644)

	loaded, err := sm.Get("corrupt")
	if err != nil {
		t.Fatal(err)
	}
	if len(loaded.Messages) != 2 {
		t.Errorf("expected 2 messages (skipping malformed), got %d", len(loaded.Messages))
	}
}
