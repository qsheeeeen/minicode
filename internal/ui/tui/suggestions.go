package tui

import (
	"fmt"
	"io"
	"strings"

	icmd "minicode/internal/commands"

	"github.com/charmbracelet/bubbles/list"
	tea "github.com/charmbracelet/bubbletea"
	"github.com/charmbracelet/lipgloss"
)

// sugItem is a single autocomplete entry.
type sugItem struct {
	name string
	desc string
}

func (i sugItem) Title() string       { return "/" + i.name }
func (i sugItem) Description() string { return i.desc }
func (i sugItem) FilterValue() string { return i.name }

// sugDelegate renders each suggestion on a single line: /name description.
type sugDelegate struct {
	title       *lipgloss.Style
	description *lipgloss.Style
	selected    *lipgloss.Style
}

func (d sugDelegate) Height() int                             { return 1 }
func (d sugDelegate) Spacing() int                            { return 0 }
func (d sugDelegate) Update(_ tea.Msg, _ *list.Model) tea.Cmd { return nil }
func (d sugDelegate) Render(w io.Writer, m list.Model, index int, item list.Item) {
	i, ok := item.(sugItem)
	if !ok {
		return
	}

	str := fmt.Sprintf("%d. %s", index+1, i.Title())

	fn := lipgloss.NewStyle().PaddingLeft(4).Render
	if index == m.Index() {
		fn = func(s ...string) string {
			return lipgloss.NewStyle().PaddingLeft(2).Foreground(lipgloss.Color("170")).Render("> " + strings.Join(s, " "))
		}
	}

	fmt.Fprint(w, fn(str))
}

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
	d := sugDelegate{}
	h := min(len(items), 10)
	l := list.New(listItems, d, 50, h)
	l.SetShowHelp(true)
	l.SetShowStatusBar(false)
	l.SetShowTitle(false)
	l.SetFilteringEnabled(false)
	l.Styles.Title = lipgloss.NewStyle()
	l.Styles.PaginationStyle = lipgloss.NewStyle()
	l.Styles.HelpStyle = lipgloss.NewStyle()

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
		Render(s.list.View())
	return mainInput + "\n" + box
}
