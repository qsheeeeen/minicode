package tui

import "github.com/charmbracelet/lipgloss"

// Version is the application version, set at build time via ldflags.
var Version = "0.1.0"

var (
	styleHeaderCyan = lipgloss.NewStyle().Foreground(lipgloss.Color("6")).Bold(true)      // cyan
	styleDim        = lipgloss.NewStyle().Foreground(lipgloss.Color("8"))                 // grey/dim
	styleGreen      = lipgloss.NewStyle().Foreground(lipgloss.Color("2"))                 // green
	styleMagenta    = lipgloss.NewStyle().Foreground(lipgloss.Color("5"))                 // magenta
	styleYellow     = lipgloss.NewStyle().Foreground(lipgloss.Color("3"))                 // yellow
	styleRed        = lipgloss.NewStyle().Foreground(lipgloss.Color("1"))                 // red

	styleUserBg     = lipgloss.NewStyle().Background(lipgloss.Color("8")).Foreground(lipgloss.Color("15")).Bold(true).Padding(0, 1)
	styleToolCall   = lipgloss.NewStyle().Foreground(lipgloss.Color("3"))                 // yellow
	styleThinking   = lipgloss.NewStyle().Foreground(lipgloss.Color("8")).Italic(true)
	styleErrorMsg   = lipgloss.NewStyle().Foreground(lipgloss.Color("1")).Bold(true)      // red bold

	styleInputBorder = lipgloss.NewStyle().Border(lipgloss.NormalBorder()).BorderForeground(lipgloss.Color("8")).Padding(0, 1)
	styleInputArrow  = lipgloss.NewStyle().Foreground(lipgloss.Color("6")).Bold(true)     // cyan
)
