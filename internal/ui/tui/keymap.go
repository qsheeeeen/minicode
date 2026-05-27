package tui

import "github.com/charmbracelet/bubbles/key"

// TUIKeyMap holds all keybindings for the TUI and implements help.KeyMap.
type TUIKeyMap struct {
	// Normal mode
	Submit     key.Binding
	Quit       key.Binding
	Abort      key.Binding
	CycleMode  key.Binding
}

// DefaultKeyMap returns a TUIKeyMap with default bindings.
func DefaultKeyMap() TUIKeyMap {
	return TUIKeyMap{
		Submit: key.NewBinding(
			key.WithKeys("enter"),
			key.WithHelp("enter", "send"),
		),
		Quit: key.NewBinding(
			key.WithKeys("ctrl+c"),
			key.WithHelp("ctrl+c", "quit"),
		),
		Abort: key.NewBinding(
			key.WithKeys("esc"),
			key.WithHelp("esc", "abort"),
		),
		CycleMode: key.NewBinding(
			key.WithKeys("shift+tab"),
			key.WithHelp("shift+tab", "cycle perm mode"),
		),
	}
}

// ShortHelp returns the short help bindings.
func (k TUIKeyMap) ShortHelp() []key.Binding {
	return []key.Binding{k.Submit, k.Quit, k.CycleMode}
}

// FullHelp returns grouped help bindings.
func (k TUIKeyMap) FullHelp() [][]key.Binding {
	return [][]key.Binding{
		{k.Submit, k.Abort, k.Quit},
		{k.CycleMode},
	}
}
