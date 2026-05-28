package main

import (
	"fmt"
	"os"
	"strings"

	icmd "minicode/internal/commands"
	"minicode/internal/ui/tui"

	"github.com/charmbracelet/bubbles/textarea"
	tea "github.com/charmbracelet/bubbletea"
	"github.com/charmbracelet/lipgloss"
)

type model struct {
	ta      textarea.Model
	suggest tui.Suggestions
}

func newModel() *model {
	ta := textarea.New()
	ta.Placeholder = "Type / to see suggestions..."
	ta.ShowLineNumbers = false
	ta.Focus()
	ta.SetWidth(60)
	ta.SetHeight(3)

	return &model{ta: ta}
}

func (m *model) Init() tea.Cmd { return textarea.Blink }

func (m *model) Update(msg tea.Msg) (tea.Model, tea.Cmd) {
	switch msg := msg.(type) {
	case tea.KeyMsg:
		switch msg.Type {
		case tea.KeyCtrlC:
			return m, tea.Quit
		case tea.KeyTab:
			if m.suggest.IsActive() {
				m.ta.SetValue(m.suggest.Accept(m.ta.Value()))
				m.suggest.Clear()
				return m, nil
			}
		case tea.KeyUp:
			if m.suggest.IsActive() {
				m.suggest.Up()
				return m, nil
			}
		case tea.KeyDown:
			if m.suggest.IsActive() {
				m.suggest.Down()
				return m, nil
			}
		case tea.KeyEsc:
			if m.suggest.IsActive() {
				m.suggest.Clear()
				return m, nil
			}
		}

		var cmd tea.Cmd
		m.ta, cmd = m.ta.Update(msg)

		val := m.ta.Value()
		if len(val) > 0 && val[0] == '/' {
			partial := strings.ToLower(val[1:])
			all := icmd.List()
			var filtered []icmd.Command
			for _, c := range all {
				if strings.HasPrefix(strings.ToLower(c.Name), partial) {
					filtered = append(filtered, c)
				}
			}
			m.suggest.Set(filtered)
		} else {
			m.suggest.Clear()
		}
		return m, cmd
	}
	return m, nil
}

func (m *model) View() string {
	prefix := lipgloss.NewStyle().Foreground(lipgloss.Color("6")).Bold(true).Render("> ")
	inputView := prefix + m.ta.View()
	border := lipgloss.NewStyle().Border(lipgloss.NormalBorder()).BorderForeground(lipgloss.Color("8")).Padding(0, 1)
	mainInput := border.Render(inputView)

	if m.suggest.IsActive() {
		return m.suggest.View(mainInput) + "\n"
	}
	return mainInput + "\n"
}

func main() {
	p := tea.NewProgram(newModel())
	if _, err := p.Run(); err != nil {
		fmt.Fprintf(os.Stderr, "error: %v\n", err)
		os.Exit(1)
	}
}
