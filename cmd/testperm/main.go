package main

import (
	"fmt"
	"os"

	"minicode/internal/ui/tui"

	tea "github.com/charmbracelet/bubbletea"
)

type model struct {
	perm   tui.PermissionPrompt
	result string
	done   bool
}

func (m *model) Init() tea.Cmd { return nil }

func (m *model) Update(msg tea.Msg) (tea.Model, tea.Cmd) {
	switch msg := msg.(type) {
	case tea.KeyMsg:
		if m.perm.IsActive() {
			m.perm.Update(msg)
			if !m.perm.IsActive() {
				m.done = true
				return m, tea.Quit
			}
			return m, nil
		}
	case tea.WindowSizeMsg:
		return m, nil
	}
	return m, nil
}

func (m *model) View() string {
	if m.done {
		return ""
	}
	return m.perm.View(80)
}

func main() {
	ch := make(chan string)
	m := &model{}
	m.perm.Activate("Allow tool: Bash(\"rm -rf /tmp/test\")?", ch)

	p := tea.NewProgram(m)
	go func() {
		result := <-ch
		m.result = result
	}()

	if _, err := p.Run(); err != nil {
		fmt.Fprintf(os.Stderr, "error: %v\n", err)
		os.Exit(1)
	}
	fmt.Printf("Selected: %s\n", m.result)
}
