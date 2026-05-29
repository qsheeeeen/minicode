package tui

import (
	"github.com/charmbracelet/bubbles/spinner"
	tea "github.com/charmbracelet/bubbletea"
)

// StatusModel shows a thinking indicator between viewport and input.
type StatusModel struct {
	spinner   spinner.Model
	streaming bool
}

// NewStatusModel creates a status model with an initialized spinner.
func NewStatusModel() StatusModel {
	sp := spinner.New()
	sp.Spinner = spinner.Dot
	sp.Style = styleThinking
	return StatusModel{spinner: sp}
}

// Update processes spinner tick messages.
func (s *StatusModel) Update(msg tea.Msg) tea.Cmd {
	var cmd tea.Cmd
	s.spinner, cmd = s.spinner.Update(msg)
	return cmd
}

// View renders the status line. Returns empty string when idle.
func (s *StatusModel) View() string {
	if !s.streaming {
		return ""
	}
	return s.spinner.View() + " Thinking..."
}
