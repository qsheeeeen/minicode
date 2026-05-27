package main

import (
	"fmt"
	"os"

	"minicode/internal/domain"
	"minicode/internal/ui/tui"

	tea "github.com/charmbracelet/bubbletea"
)

type model struct {
	ask    tui.AskUserPrompt
	result string
	done   bool
}

func (m *model) Init() tea.Cmd { return nil }

func (m *model) Update(msg tea.Msg) (tea.Model, tea.Cmd) {
	switch msg := msg.(type) {
	case tea.KeyMsg:
		if m.ask.IsActive() {
			m.ask.Update(msg)
			if !m.ask.IsActive() {
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
	return m.ask.View(80)
}

func main() {
	ch := make(chan string)
	m := &model{}
	options := []domain.AskOption{
		{Label: "Approve", Description: "Allow this action"},
		{Label: "Deny", Description: "Block this action"},
		{Label: "Skip", Description: "Skip for now"},
	}
	m.ask.Activate("Do you want to proceed with the deployment?", options, false, ch)

	p := tea.NewProgram(m)
	go func() {
		result := <-ch
		m.result = result
	}()

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
