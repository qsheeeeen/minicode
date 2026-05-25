package tui

import (
	"github.com/charmbracelet/bubbles/help"
	"github.com/charmbracelet/bubbles/list"
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

// TUIModel is the top-level Bubble Tea model.
type TUIModel struct {
	program       *tea.Program
	agent         *agent.Agent
	agentRegistry *agent.AgentRegistry
	cmdReg        *icmd.Registry
	viewport      viewport.Model
	input         textarea.Model
	spinner       spinner.Model
	prog          progress.Model

	messages   []domain.DisplayMessage
	streaming  bool
	tokenCount int
	modelName  string
	session    string

	// Hierarchical sessions
	sessions []agent.AgentSession
	activeID string

	// Autocomplete state
	suggestions []icmd.Command
	selectedIdx int

	// Permission prompt state
	permPending bool
	permText    string
	permOptions []string
	permResolve chan string // to return the answer

	// Generic prompter state (AskUser tool)
	askPending  bool
	askQuestion string
	askOptions  []domain.AskOption
	askMulti    bool
	askSelected []bool      // for multiselect
	askCurrent  int         // current hover index
	askResolve  chan string // to return the answer

	// Select mode: uses bubbles/list
	selectList  list.Model
	selectMode  string // effort-select, session-list, model-tier, ...
	help        help.Model

	// Model wizard state machine
	modelWizardEditTier string
	modelWizardProvider string

	promptFiles []string

	width  int
	height int
	ready  bool
	err    error
}

// NewTUIModel creates the TUI model.
func NewTUIModel(ag *agent.Agent, registry *agent.AgentRegistry, cmdReg *icmd.Registry, promptFiles []string) *TUIModel {
	ta := textarea.New()
	ta.Placeholder = "Type a message or /command..."
	ta.ShowLineNumbers = false
	ta.SetHeight(3)
	ta.Focus()

	vp := viewport.New(80, 20)

	sp := spinner.New()
	sp.Spinner = spinner.Dot
	sp.Style = lipgloss.NewStyle().Foreground(lipgloss.Color("5"))

	pg := progress.New(progress.WithDefaultGradient())

	m := &TUIModel{
		agent:         ag,
		agentRegistry: registry,
		cmdReg:        cmdReg,
		viewport:      vp,
		input:         ta,
		spinner:       sp,
		prog:          pg,
		modelName:     ag.Model(),
		session:       ag.SessionName(),
		messages:      ToDisplayMessages(ag.Store().Turns(), ag.Store().Statuses(), ag.Store().IsStreaming()),
		streaming:     ag.Store().IsStreaming(),
		tokenCount:    ag.TokenCount(),
		activeID:      ag.ID(),
		promptFiles:   promptFiles,
	}

	m.viewport.SetContent(m.renderMessages())

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

	if registry != nil {
		m.sessions = registry.List()
		registry.OnUpdate(func(sessions []agent.AgentSession) {
			if m.program != nil {
				m.program.Send(sessionUpdateMsg{sessions: sessions})
			}
		})
	}

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
	return tea.Batch(textarea.Blink, m.spinner.Tick)
}

// ---- TUI entry point ----

// RunTUI starts the interactive Bubble Tea terminal UI.
func RunTUI(ag *agent.Agent, registry *agent.AgentRegistry, cmdReg *icmd.Registry, promptFiles []string) error {
	m := NewTUIModel(ag, registry, cmdReg, promptFiles)
	p := tea.NewProgram(m, tea.WithAltScreen())
	m.program = p
	_, err := p.Run()
	return err
}
