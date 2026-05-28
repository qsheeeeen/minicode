package tui

import (
	"strings"
	"testing"
)

func TestStatusViewThinking(t *testing.T) {
	s := StatusModel{streaming: true}
	v := s.View()
	if !strings.Contains(v, "Thinking") {
		t.Errorf("expected 'Thinking' in status view, got %q", v)
	}
}

func TestStatusViewIdle(t *testing.T) {
	s := StatusModel{streaming: false}
	v := s.View()
	if v != "" {
		t.Errorf("expected empty string when idle, got %q", v)
	}
}
