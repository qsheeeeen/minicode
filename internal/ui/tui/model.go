package tui

import (
	"github.com/charmbracelet/bubbles/progress"
	"github.com/charmbracelet/bubbles/spinner"
	"github.com/charmbracelet/bubbles/textarea"
	"github.com/charmbracelet/bubbles/viewport"
	tea "github.com/charmbracelet/bubbletea"
	"github.com/charmbracelet/lipgloss"
	"minicode/internal/agent"
	icmd "minicode/internal/commands"
	"minicode/internal/domain"
	"minicode/internal/tools"
)

// TUIModel is the top-level Bubble Tea model composed of sub-models.
type TUIModel struct {
	program *tea.Program
	agent   *agent.Agent
	cmdReg  *icmd.Registry

	Header   HeaderModel
	Input    InputModel
	Viewport ViewportModel
	Status   StatusModel
	Select   SelectModel

	width  int
	height int
	ready  bool
}

// NewTUIModel creates the TUI model.
func NewTUIModel(ag *agent.Agent, cmdReg *icmd.Registry, promptFiles []string) *TUIModel {
	m := &TUIModel{
		agent:  ag,
		cmdReg: cmdReg,
	}

	// Input
	m.Input.textarea = textarea.New()
	m.Input.textarea.Placeholder = "Type a message or /command..."
	m.Input.textarea.ShowLineNumbers = false
	m.Input.textarea.SetHeight(3)
	m.Input.textarea.Focus()

	m.Input.spinner = spinner.New()
	m.Input.spinner.Spinner = spinner.Dot
	m.Input.spinner.Style = lipgloss.NewStyle().Foreground(lipgloss.Color("5"))

	// Viewport
	m.Viewport.viewport = viewport.New(80, 20)
	m.Viewport.messages = ToDisplayMessages(ag.Store().Turns(), ag.Store().Statuses(), ag.Store().IsStreaming())

	// Status
	m.Status.prog = progress.New(progress.WithDefaultGradient())
	m.Status.modelName = ag.Model()
	m.Status.session = ag.SessionName()

	// Header
	m.Header.promptFiles = promptFiles

	// Set viewport content
	m.Viewport.viewport.SetContent(m.Viewport.Render())

	// Callbacks
	ag.OnDisplayChange(func() {
		if m.program != nil {
			m.program.Send(displayChangeMsg{})
		}
	})

	ag.OnTokenUpdate(func(total int) {
		if m.program != nil {
			m.program.Send(tokenUpdateMsg{total: total})
		}
	})

	ag.SetAskUserFn(func(question string, options []domain.AskOption, multi bool) string {
		ch := make(chan string)
		if m.program != nil {
			m.program.Send(askPromptMsg{
				question: question,
				options:  options,
				multi:    multi,
				resolve:  ch,
			})
		} else {
			return ""
		}
		return <-ch
	})

	if p := ag.PermissionSvc(); p != nil {
		if ps, ok := p.(*tools.PermissionService); ok {
			ps.SetPromptFn(func(displayText string) string {
				ch := make(chan string)
				if m.program != nil {
					m.program.Send(permPromptMsg{displayText: displayText, resolve: ch})
				} else {
					return "no"
				}
				return <-ch
			})
		}
	}

	return m
}

// Init is the Bubble Tea Init function.
func (m *TUIModel) Init() tea.Cmd {
	return tea.Batch(textarea.Blink, m.Input.spinner.Tick)
}

// ---- TUI entry point ----

// RunTUI starts the interactive Bubble Tea terminal UI.
func RunTUI(ag *agent.Agent, cmdReg *icmd.Registry, promptFiles []string) error {
	mdl := NewTUIModel(ag, cmdReg, promptFiles)
	p := tea.NewProgram(mdl, tea.WithAltScreen())
	mdl.program = p
	_, err := p.Run()
	return err
}
