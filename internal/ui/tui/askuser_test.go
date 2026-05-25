package tui

import (
	"strings"
	"testing"

	tea "github.com/charmbracelet/bubbletea"
	"minicode/internal/domain"
)

func TestAskUserPromptView(t *testing.T) {
	var a AskUserPrompt
	ch := make(chan string, 1)
	a.Activate("Choose one", []domain.AskOption{
		{Label: "A", Description: "First"},
		{Label: "B", Description: "Second"},
	}, false, ch)

	if !a.IsActive() {
		t.Error("should be active after Activate")
	}

	v := a.View(100)
	if !strings.Contains(v, "Choose one") {
		t.Error("should show the question")
	}
	if !strings.Contains(v, "A") && !strings.Contains(v, "B") {
		t.Error("should show options")
	}
}

func TestAskUserPromptSelectAndConfirm(t *testing.T) {
	var a AskUserPrompt
	ch := make(chan string, 1)
	a.Activate("Pick", []domain.AskOption{
		{Label: "opt1"},
		{Label: "opt2"},
	}, false, ch)

	// Navigate down
	a.Update(tea.KeyMsg{Type: tea.KeyDown})
	if a.current != 1 {
		t.Error("should navigate to second option")
	}

	// Confirm
	handled := a.Update(tea.KeyMsg{Type: tea.KeyEnter})
	if !handled {
		t.Error("Enter should confirm")
	}
	if a.IsActive() {
		t.Error("should not be active after confirm")
	}

	select {
	case res := <-ch:
		if res != "opt2" {
			t.Errorf("expected 'opt2', got %q", res)
		}
	default:
		t.Error("should have sent result")
	}
}

func TestAskUserPromptCancel(t *testing.T) {
	var a AskUserPrompt
	ch := make(chan string, 1)
	a.Activate("Pick", []domain.AskOption{{Label: "opt1"}}, false, ch)

	handled := a.Update(tea.KeyMsg{Type: tea.KeyEsc})
	if !handled {
		t.Error("Esc should cancel")
	}
	if a.IsActive() {
		t.Error("should not be active after cancel")
	}

	select {
	case res := <-ch:
		if res != "" {
			t.Errorf("expected empty string on cancel, got %q", res)
		}
	default:
		t.Error("should have sent cancel to channel")
	}
}
