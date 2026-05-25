package tui

import (
	"github.com/charmbracelet/bubbles/spinner"
	"github.com/charmbracelet/bubbles/textarea"
	tea "github.com/charmbracelet/bubbletea"
)

// InputModel is the composite input area. It delegates to sub-components
// PermissionPrompt, AskUserPrompt, Suggestions, and SelectModel depending on state.
type InputModel struct {
	textarea  textarea.Model
	spinner   spinner.Model
	streaming bool

	Perm    PermissionPrompt
	Ask     AskUserPrompt
	Suggest Suggestions
}

// handleKey routes a key message through active sub-components.
// Returns (handled, quit).
func (in *InputModel) handleKey(msg tea.KeyMsg) (handled bool, shouldQuit bool) {
	if in.Perm.Active() {
		return in.Perm.Update(msg), false
	}
	if in.Ask.Active() {
		return in.Ask.Update(msg), false
	}
	return false, false
}

// View renders the input area. Delegates to sub-components when active.
func (in *InputModel) View(width int) string {
	if in.Perm.Active() {
		return in.Perm.View(width)
	}
	if in.Ask.Active() {
		return in.Ask.View(width)
	}

	prefix := styleInputArrow.Render("> ")
	if in.streaming {
		prefix = in.spinner.View() + " "
	}

	inputView := prefix + in.textarea.View()
	mainInput := styleInputBorder.Width(width - 2).Render(inputView)

	if in.Suggest.Active() && !in.streaming {
		return in.Suggest.View(mainInput) + "\n"
	}
	return mainInput + "\n"
}
