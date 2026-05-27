package log

import (
	"context"
	"crypto/md5"
	"fmt"
	"io"
	"log/slog"
	"os"
	"path/filepath"
	"sync"
)

var (
	mu     sync.Mutex
	h      = newSwitchHandler()
	logger = slog.New(h)
)

func init() {
	// 创建默认日志文件，程序启动时的日志先写这里
	f := mustOpenDefaultLog()
	if f != nil {
		h.set(slog.NewJSONHandler(f, &slog.HandlerOptions{Level: slog.LevelInfo}))
	}
}

// Get returns the current global logger.
func Get() *slog.Logger { return logger }

// Set switches the global logger to a session-specific file.
func Set(projectHash, sessionName string) {
	home, err := os.UserHomeDir()
	if err != nil {
		return
	}
	logDir := filepath.Join(home, ".minicode", "sessions", projectHash)
	if err := os.MkdirAll(logDir, 0o755); err != nil {
		return
	}
	logFile := filepath.Join(logDir, sessionName+".log.json")
	f, err := os.OpenFile(logFile, os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0o644)
	if err != nil {
		return
	}

	target := slog.NewJSONHandler(f, &slog.HandlerOptions{Level: slog.LevelInfo})
	h.set(target)
}

// ProjectHash returns a 12-char hex hash of the current working directory.
func ProjectHash() string {
	cwd, err := os.Getwd()
	if err != nil {
		return "000000000000"
	}
	sum := md5.Sum([]byte(cwd))
	return fmt.Sprintf("%x", sum)[:12]
}

func mustOpenDefaultLog() *os.File {
	home, err := os.UserHomeDir()
	if err != nil {
		return nil
	}
	logDir := filepath.Join(home, ".minicode")
	if err := os.MkdirAll(logDir, 0o755); err != nil {
		return nil
	}
	f, err := os.OpenFile(filepath.Join(logDir, "minicode.log"), os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0o644)
	if err != nil {
		return nil
	}
	return f
}

type switchHandler struct {
	mu     sync.Mutex
	target slog.Handler
}

func newSwitchHandler() *switchHandler {
	return &switchHandler{target: slog.NewTextHandler(io.Discard, nil)}
}

func (h *switchHandler) set(t slog.Handler) {
	h.mu.Lock()
	defer h.mu.Unlock()
	h.target = t
}

func (h *switchHandler) Enabled(ctx context.Context, level slog.Level) bool {
	h.mu.Lock()
	defer h.mu.Unlock()
	return h.target.Enabled(ctx, level)
}

func (h *switchHandler) Handle(ctx context.Context, r slog.Record) error {
	h.mu.Lock()
	defer h.mu.Unlock()
	return h.target.Handle(ctx, r)
}

func (h *switchHandler) WithAttrs([]slog.Attr) slog.Handler { return h }
func (h *switchHandler) WithGroup(string) slog.Handler       { return h }
