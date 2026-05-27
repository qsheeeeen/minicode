package log

import (
	"crypto/md5"
	"fmt"
	"log/slog"
	"os"
	"path/filepath"
)

// Default is the shared application logger (stderr, for use outside session context).
var Default = slog.New(slog.NewTextHandler(os.Stderr, nil))

// ProjectHash returns a 12-char hex hash of the current working directory,
// used to isolate log files per project (matching the TypeScript implementation).
func ProjectHash() string {
	cwd, err := os.Getwd()
	if err != nil {
		return "000000000000"
	}
	sum := md5.Sum([]byte(cwd))
	return fmt.Sprintf("%x", sum)[:12]
}

// NewSessionLogger creates a logger that writes JSON lines to
// ~/.minicode/sessions/<projectHash>/<sessionName>.log.
// Each line includes the session name and project hash as base fields.
func NewSessionLogger(projectHash, sessionName string) *slog.Logger {
	home, err := os.UserHomeDir()
	if err != nil {
		return Default
	}

	logDir := filepath.Join(home, ".minicode", "sessions", projectHash)
	if err := os.MkdirAll(logDir, 0o755); err != nil {
		return Default
	}

	logFile := filepath.Join(logDir, sessionName+".log")
	f, err := os.OpenFile(logFile, os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0o644)
	if err != nil {
		return Default
	}

	handler := slog.NewJSONHandler(f, &slog.HandlerOptions{Level: slog.LevelInfo})
	return slog.New(handler).With("session", sessionName, "projectHash", projectHash)
}
