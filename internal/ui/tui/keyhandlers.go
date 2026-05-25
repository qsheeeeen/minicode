package tui

import (
	"strings"
	tea "github.com/charmbracelet/bubbletea"
)

func (m *TUIModel) handleAskKey(msg tea.KeyMsg) (tea.Model, tea.Cmd) {
	switch msg.Type {
	case tea.KeyUp:
		m.askCurrent = (m.askCurrent - 1 + len(m.askOptions)) % len(m.askOptions)
	case tea.KeyDown:
		m.askCurrent = (m.askCurrent + 1) % len(m.askOptions)
	case tea.KeySpace:
		if m.askMulti {
			m.askSelected[m.askCurrent] = !m.askSelected[m.askCurrent]
		}
	case tea.KeyEnter:
		var result string
		if m.askMulti {
			var selected []string
			for i, s := range m.askSelected {
				if s {
					selected = append(selected, m.askOptions[i].Label)
				}
			}
			result = strings.Join(selected, ",")
		} else {
			result = m.askOptions[m.askCurrent].Label
		}
		m.askPending = false
		if m.askResolve != nil {
			m.askResolve <- result
		}
	case tea.KeyEsc:
		m.askPending = false
		if m.askResolve != nil {
			m.askResolve <- ""
		}
	}
	return m, nil
}

func (m *TUIModel) handlePermKey(msg tea.KeyMsg) (tea.Model, tea.Cmd) {
	var res string
	switch msg.String() {
	case "y":
		res = "yes"
	case "n", "esc":
		res = "no"
	case "a":
		res = "yolo"
	default:
		return m, nil
	}

	m.permPending = false
	if m.permResolve != nil {
		m.permResolve <- res
	}
	return m, nil
}
