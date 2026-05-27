package tui

import (
	"fmt"

	"github.com/charmbracelet/bubbles/list"
	tea "github.com/charmbracelet/bubbletea"
	"github.com/charmbracelet/lipgloss"
)

// PermissionPrompt shown when a tool requires user approval.
type PermissionPrompt struct {
	pending bool
	text    string
	list    list.Model
	resolve chan string
}

func (p *PermissionPrompt) IsActive() bool { return p.pending }

func (p *PermissionPrompt) Activate(text string, resolve chan string) {
	p.pending = true
	p.text = text
	p.resolve = resolve

	items := []list.Item{
		permItem{label: "Yes", value: "yes"},
		permItem{label: "No", value: "no"},
		permItem{label: "Yes to all", value: "yolo"},
	}
	d := list.NewDefaultDelegate()
	d.SetSpacing(0)
	d.SetHeight(1)
	d.ShowDescription = false
	d.Styles.SelectedTitle = d.Styles.SelectedTitle.Foreground(lipgloss.Color("6"))
	l := list.New(items, d, 40, len(items)*2)
	l.SetShowHelp(true)
	l.SetShowStatusBar(false)
	l.SetShowPagination(false)
	l.SetShowTitle(false)
	l.SetFilteringEnabled(false)
	l.KeyMap.Quit.Unbind()
	p.list = l
}

func (p *PermissionPrompt) Update(msg tea.KeyMsg) (handled bool) {
	if !p.pending {
		return false
	}
	switch msg.Type {
	case tea.KeyEnter:
		if item, ok := p.list.SelectedItem().(permItem); ok {
			p.pending = false
			if p.resolve != nil {
				p.resolve <- item.value
			}
		}
		return true
	}
	var cmd tea.Cmd
	p.list, cmd = p.list.Update(msg)
	_ = cmd
	return true
}

func (p *PermissionPrompt) View(width int) string {
	title := styleToolCall.Render("Permission Required")
	detail := styleDim.Render(p.text)
	body := fmt.Sprintf("%s\n\n%s\n\n%s", title, detail, p.list.View())

	border := lipgloss.NewStyle().
		Border(lipgloss.NormalBorder()).
		BorderForeground(lipgloss.Color("3")).
		Padding(0, 1)

	return border.Render(body) + "\n"
}

type permItem struct {
	label string
	value string
}

func (i permItem) Title() string       { return i.label }
func (i permItem) Description() string { return "" }
func (i permItem) FilterValue() string { return i.label }
