package main

import (
	"fmt"
	"os"

	icmd "minicode/internal/commands"
	"minicode/internal/ui/tui"

	tea "github.com/charmbracelet/bubbletea"
)

type model struct {
	sel    tui.SelectModel
	result string
	done   bool
}

func (m *model) Init() tea.Cmd { return nil }

func (m *model) Update(msg tea.Msg) (tea.Model, tea.Cmd) {
	switch msg := msg.(type) {
	case tea.KeyMsg:
		if m.sel.Active() {
			consumed, val, cmd := m.sel.Update(msg)
			if consumed && val != "" {
				m.result = val
				m.done = true
				return m, tea.Quit
			}
			if consumed {
				return m, cmd
			}
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
	if m.sel.Active() {
		return m.sel.View()
	}
	return "Select mode not active\n"
}

func main() {
	items := []icmd.SelectItem{
		{Value: "low", Label: "low", Description: "Minimal effort"},
		{Value: "medium", Label: "medium", Description: "Balanced effort"},
		{Value: "high", Label: "high", Description: "Maximum effort"},
	}

	m := &model{}
	m.sel.SetMode("effort-select", "Select effort level:", items)

	p := tea.NewProgram(m)
	if _, err := p.Run(); err != nil {
		fmt.Fprintf(os.Stderr, "error: %v\n", err)
		os.Exit(1)
	}
	if m.result == "" {
		fmt.Println("Cancelled")
	} else {
		fmt.Printf("Selected: %s\n", m.result)
	}
}
