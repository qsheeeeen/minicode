package tui

import (
	"github.com/charmbracelet/bubbles/list"
	tea "github.com/charmbracelet/bubbletea"
	"github.com/charmbracelet/lipgloss"
	"minicode/internal/domain"
)

// askItem is a single answer option.
type askItem struct {
	label string
	desc  string
}

func (i askItem) Title() string       { return i.label }
func (i askItem) Description() string { return i.desc }
func (i askItem) FilterValue() string { return i.label }

// AskUserPrompt shown when the agent asks the user a question.
type AskUserPrompt struct {
	pending  bool
	question string
	multi    bool
	list     list.Model
	resolve  chan string
}

func (a *AskUserPrompt) IsActive() bool { return a.pending }

func (a *AskUserPrompt) Activate(question string, options []domain.AskOption, multi bool, resolve chan string) {
	a.pending = true
	a.question = question
	a.multi = multi
	a.resolve = resolve

	items := make([]list.Item, len(options))
	for i, opt := range options {
		items[i] = askItem{label: opt.Label, desc: opt.Description}
	}

	l := list.New(items, selectDelegate{showDesc: true}, 60, 5)
	l.SetShowHelp(true)
	l.SetShowStatusBar(false)
	l.SetShowTitle(false)
	l.SetFilteringEnabled(false)
	newListStyles(&l)
	l.KeyMap.Quit.Unbind()
	a.list = l
}

func (a *AskUserPrompt) Update(msg tea.KeyMsg) (handled bool) {
	if !a.pending {
		return false
	}
	switch msg.Type {
	case tea.KeyEnter:
		if item, ok := a.list.SelectedItem().(askItem); ok {
			a.pending = false
			if a.resolve != nil {
				a.resolve <- item.label
			}
		}
		return true
	case tea.KeyEsc:
		a.pending = false
		if a.resolve != nil {
			a.resolve <- ""
		}
		return true
	}
	var cmd tea.Cmd
	a.list, cmd = a.list.Update(msg)
	_ = cmd
	return true
}

func (a *AskUserPrompt) View(width int) string {
	if !a.pending {
		return ""
	}
	qBorder := lipgloss.NewStyle().
		Border(lipgloss.RoundedBorder()).
		BorderForeground(lipgloss.Color("3")).
		Padding(0, 1)
	questionBox := qBorder.Render(a.question)

	oBorder := lipgloss.NewStyle().
		Border(lipgloss.NormalBorder()).
		BorderForeground(lipgloss.Color("8")).
		Padding(0, 1)

	return questionBox + "\n" + oBorder.Render(a.list.View())
}
