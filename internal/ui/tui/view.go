package tui

// View is the Bubble Tea View function.
func (m *TUIModel) View() string {
	if !m.ready {
		return "Initializing...\n"
	}

	header := m.Header.View(m.width)
	viewport := m.Viewport.viewport.View()
	input := m.Input.View(m.width)
	status := m.Status.View(m.agent, m.width)

	// When select mode is active, input area shows the list instead
	if m.Select.active() {
		input = m.Select.list.View()
	}

	return header + viewport + "\n" + input + status
}
