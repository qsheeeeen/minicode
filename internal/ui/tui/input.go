package tui

import (
	"strings"

	"github.com/charmbracelet/bubbles/spinner"
	"github.com/charmbracelet/bubbles/textarea"
	tea "github.com/charmbracelet/bubbletea"
	icmd "minicode/internal/commands"
)

// InputModel is the composite input area.
type InputModel struct {
	textarea  textarea.Model
	spinner   spinner.Model
	streaming bool

	Perm    PermissionPrompt
	Ask     AskUserPrompt
	Suggest Suggestions
}

// Update processes a key message. Returns whether the key was consumed
// by a sub-component, and any tea.Cmd from the textarea.
func (in *InputModel) Update(msg tea.KeyMsg, cmdReg *icmd.Registry) (consumed bool, cmd tea.Cmd) {
	// Route to active sub-components
	if in.Perm.Active() {
		return in.Perm.Update(msg), nil
	}
	if in.Ask.Active() {
		return in.Ask.Update(msg), nil
	}

	// Suggestions navigation (only when not streaming)
	if in.Suggest.Active() && !in.streaming {
		switch msg.Type {
		case tea.KeyTab:
			in.textarea.SetValue(in.Suggest.Accept(in.textarea.Value()))
			in.Suggest.Clear()
			return true, nil
		case tea.KeyUp:
			in.Suggest.Up()
			return true, nil
		case tea.KeyDown:
			in.Suggest.Down()
			return true, nil
		case tea.KeyEsc:
			in.Suggest.Clear()
			return true, nil
		}
	}

	// Update textarea and filter suggestions
	if !in.streaming {
		var c tea.Cmd
		in.textarea, c = in.textarea.Update(msg)

		if cmdReg != nil {
			val := in.textarea.Value()
			if len(val) > 0 && val[0] == '/' {
				partial := strings.ToLower(val[1:])
				all := cmdReg.List()
				var filtered []icmd.Command
				for _, cmd := range all {
					if strings.HasPrefix(strings.ToLower(cmd.Name), partial) {
						filtered = append(filtered, cmd)
					}
				}
				in.Suggest.Set(filtered)
			} else {
				in.Suggest.Clear()
			}
		}
		return false, c
	}

	return false, nil
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
