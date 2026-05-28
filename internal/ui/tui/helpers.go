package tui

import (
	"fmt"
	"io"
	"strings"

	"github.com/charmbracelet/bubbles/list"
	tea "github.com/charmbracelet/bubbletea"
	"github.com/charmbracelet/lipgloss"
)

// listItem implements list.DefaultItem for use with bubbles/list selections.
type listItem struct {
	title string
	desc  string
}

func (i listItem) Title() string       { return i.title }
func (i listItem) Description() string { return i.desc }
func (i listItem) FilterValue() string { return i.title }

// selectDelegate renders numbered list items with a ">" indicator for the
// selected item, matching the official Bubble Tea list example style.
type selectDelegate struct {
	showDesc bool
}

func (d selectDelegate) Height() int {
	if d.showDesc {
		return 2
	}
	return 1
}

func (d selectDelegate) Spacing() int                            { return 0 }
func (d selectDelegate) Update(_ tea.Msg, _ *list.Model) tea.Cmd { return nil }

func (d selectDelegate) Render(w io.Writer, m list.Model, index int, li list.Item) {
	item, ok := li.(list.DefaultItem)
	if !ok {
		return
	}

	str := fmt.Sprintf("%d. %s", index+1, item.Title())

	if index == m.Index() {
		fmt.Fprint(w, styleSelectedItem.Render("> "+str))
		if d.showDesc && item.Description() != "" {
			fmt.Fprint(w, "\n"+styleSelectedDesc.Render("  "+item.Description()))
		}
	} else {
		fmt.Fprint(w, styleItem.Render(str))
		if d.showDesc && item.Description() != "" {
			fmt.Fprint(w, "\n"+styleDim.Render("   "+item.Description()))
		}
	}
}

// List style constants matching the official example.
var (
	styleItem         = lipgloss.NewStyle().PaddingLeft(4)
	styleSelectedItem = lipgloss.NewStyle().PaddingLeft(2).Foreground(lipgloss.Color("170"))
	styleSelectedDesc = lipgloss.NewStyle().PaddingLeft(4).Foreground(lipgloss.Color("245"))
	styleListTitle    = lipgloss.NewStyle().MarginLeft(2)
	stylePagination   = lipgloss.NewStyle().PaddingLeft(4)
	styleListHelp     = lipgloss.NewStyle().PaddingLeft(4).PaddingBottom(1)
)

// newListStyles applies consistent styles to a list.Model.
func newListStyles(l *list.Model) {
	l.Styles.Title = styleListTitle
	l.Styles.PaginationStyle = stylePagination
	l.Styles.HelpStyle = styleListHelp
}

func truncate(s string, maxLen int) string {
	lines := strings.Split(s, "\n")
	if len(lines) > 1 {
		s = lines[0] + "..."
	}
	if len(s) > maxLen {
		s = s[:maxLen] + "..."
	}
	return s
}
