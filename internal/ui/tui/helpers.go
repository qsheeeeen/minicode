package tui

import "strings"

// listItem implements list.DefaultItem for use with bubbles/list selections.
type listItem struct {
	title string
	desc  string
}

func (i listItem) Title() string       { return i.title }
func (i listItem) Description() string { return i.desc }
func (i listItem) FilterValue() string { return i.title }

func truncate(s string, maxLen int) string {
	lines := strings.Split(s, "\n")
	if len(lines) > 1 {
		s = lines[0] + "..."
	}
	if len(s) > maxLen {
		return s[:maxLen] + "..."
	}
	return s
}
