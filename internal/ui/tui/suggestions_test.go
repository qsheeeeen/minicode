package tui

import (
	"strings"
	"testing"

	icmd "minicode/internal/commands"
)

func TestSuggestionsActive(t *testing.T) {
	var s Suggestions
	if s.IsActive() {
		t.Error("should not be active when empty")
	}
	s.Set([]icmd.Command{{Name: "test", Description: "desc"}})
	if !s.IsActive() {
		t.Error("should be active with items")
	}
}

func TestSuggestionsClear(t *testing.T) {
	var s Suggestions
	s.Set([]icmd.Command{{Name: "test"}})
	s.Clear()
	if s.IsActive() {
		t.Error("should not be active after clear")
	}
}

func TestSuggestionsNavigation(t *testing.T) {
	var s Suggestions
	s.Set([]icmd.Command{
		{Name: "clear"},
		{Name: "model"},
		{Name: "exit"},
	})
	s.Down()
	s.Down()
	// Third item should be selected
	if item, ok := s.list.SelectedItem().(sugItem); !ok || item.name != "exit" {
		t.Errorf("down x2 should select 'exit', got %v", item)
	}
	s.Up()
	if item, ok := s.list.SelectedItem().(sugItem); !ok || item.name != "model" {
		t.Errorf("up should select 'model', got %v", item)
	}
}

func TestSuggestionsView(t *testing.T) {
	var s Suggestions
	s.Set([]icmd.Command{{Name: "clear", Description: "Clear history"}})
	v := s.View("[input box]")
	if !strings.Contains(v, "[input box]") {
		t.Error("should include the main input")
	}
	if !strings.Contains(v, "/clear") {
		t.Error("should show command name")
	}
}
