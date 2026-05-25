package tui

// View is the Bubble Tea View function.
func (m *TUIModel) View() string {
	if !m.ready {
		return "Initializing...\n"
	}

	header := m.renderHeader()
	viewport := m.viewport.View()
	input := m.renderInput()
	status := m.renderStatusBar()

	// viewport.View() does NOT end with \n, so add one to prevent
	// input from concatenating onto the last padded viewport line.
	return header + viewport + "\n" + input + status
}
