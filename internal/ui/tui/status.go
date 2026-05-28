package tui

// StatusModel shows a thinking indicator between viewport and input.
type StatusModel struct {
	streaming bool
}

// View renders the status line. Returns empty string when idle.
func (s *StatusModel) View() string {
	if !s.streaming {
		return ""
	}
	return styleThinking.Render("⟳ Thinking...")
}
