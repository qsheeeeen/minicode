package tui

import (
	"strings"

	"github.com/charmbracelet/bubbles/list"
	"github.com/charmbracelet/lipgloss"
	icmd "minicode/internal/commands"
)

// Suggestions is the command autocomplete dropdown, backed by bubbles/list.
type Suggestions struct {
	list list.Model
}

func (s *Suggestions) IsActive() bool { return len(s.list.Items()) > 0 }

func (s *Suggestions) Set(items []icmd.Command) {
	listItems := make([]list.Item, len(items))
	for i, cmd := range items {
		desc := cmd.Description
		if idx := strings.Index(desc, "\n"); idx != -1 {
			desc = desc[:idx]
		}
		listItems[i] = sugItem{name: cmd.Name, desc: desc}
	}
	d := list.NewDefaultDelegate()
	d.Styles.SelectedTitle = d.Styles.SelectedTitle.Foreground(lipgloss.Color("6"))
	d.Styles.SelectedDesc = d.Styles.SelectedDesc.Foreground(lipgloss.Color("8"))

	h := len(items) + 1
	if h > 10 {
		h = 10
	}
	l := list.New(listItems, d, 50, h)
	l.SetShowHelp(false)
	l.SetShowStatusBar(false)
	l.SetShowTitle(false)
	l.SetFilteringEnabled(false)
	l.KeyMap.Quit.Unbind()
	s.list = l
}

func (s *Suggestions) Clear() { s.list = list.Model{} }
func (s *Suggestions) Up()    { s.list.CursorUp() }
func (s *Suggestions) Down()  { s.list.CursorDown() }

func (s *Suggestions) Accept(textareaValue string) string {
	if item, ok := s.list.SelectedItem().(sugItem); ok {
		return "/" + item.name + " "
	}
	return textareaValue
}

func (s *Suggestions) View(mainInput string) string {
	if !s.IsActive() {
		return mainInput
	}
	box := lipgloss.NewStyle().
		Border(lipgloss.NormalBorder()).
		BorderForeground(lipgloss.Color("8")).
		Padding(0, 1).
		Render(s.list.View() + "\n" + styleDim.Render("↑↓ navigate  Tab accept"))
	return mainInput + "\n" + box
}

type sugItem struct {
	name string
	desc string
}

func (i sugItem) Title() string       { return "/" + i.name }
func (i sugItem) Description() string { return i.desc }
func (i sugItem) FilterValue() string { return i.name }
