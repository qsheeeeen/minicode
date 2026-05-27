package tui

import (
	"context"
	"errors"
	"strings"

	"minicode/internal/agent"
	icmd "minicode/internal/commands"
	"minicode/internal/config"
	"minicode/internal/domain"
	"minicode/internal/services"
	"minicode/internal/storage"

	"github.com/charmbracelet/bubbles/help"
	"github.com/charmbracelet/bubbles/key"
	"github.com/charmbracelet/bubbles/progress"
	"github.com/charmbracelet/bubbles/spinner"
	"github.com/charmbracelet/bubbles/textarea"
	"github.com/charmbracelet/bubbles/viewport"
	tea "github.com/charmbracelet/bubbletea"
	"github.com/charmbracelet/lipgloss"
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

	keys TUIKeyMap
	help help.Model

	width  int
	height int
	ready  bool
}

// NewTUIModel creates the TUI model.
func NewTUIModel(ag *agent.Agent, promptFiles []string) *TUIModel {
	m := &TUIModel{
		agent: ag,
		keys:  DefaultKeyMap(),
		help:  help.New(),
	}

	// Input
	m.Input.textarea = textarea.New()
	m.Input.textarea.Placeholder = "Type a message or /command..."
	m.Input.textarea.ShowLineNumbers = false
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

	// Select
	m.Select.agent = ag

	// Help
	m.help.ShowAll = false
	m.help.Styles.ShortKey = styleDim
	m.help.Styles.ShortDesc = styleDim
	m.help.Styles.FullKey = styleDim
	m.help.Styles.FullDesc = styleDim

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
		if ps, ok := p.(*services.PermissionService); ok {
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

// ---- Update ----

// Update is the Bubble Tea Update function.
func (m *TUIModel) Update(msg tea.Msg) (tea.Model, tea.Cmd) {
	var cmds []tea.Cmd

	switch msg := msg.(type) {
	case permPromptMsg:
		m.Input.Perm.Activate(msg.displayText, msg.resolve)
		return m, nil

	case askPromptMsg:
		m.Input.Ask.Activate(msg.question, msg.options, msg.multi, msg.resolve)
		return m, nil

	case tea.KeyMsg:
		consumed, inputCmd := m.Input.Update(msg)
		if inputCmd != nil {
			cmds = append(cmds, inputCmd)
		}
		if consumed {
			return m, tea.Batch(cmds...)
		}

		if selConsumed, selVal, selCmd := m.Select.Update(msg); selConsumed {
			if selVal != "" {
				m.handleSelectChoice(selVal)
			}
			if selCmd != nil {
				return m, selCmd
			}
			return m, nil
		}

		switch {
		case key.Matches(msg, m.keys.Quit):
			if m.Input.streaming {
				m.agent.Abort()
				return m, nil
			}
			return m, tea.Quit

		case key.Matches(msg, m.keys.Abort):
			if m.Input.streaming {
				m.agent.Abort()
			}
			return m, nil

		case key.Matches(msg, m.keys.CycleMode):
			if p := m.agent.PermissionSvc(); p != nil {
				p.CycleMode()
			}
			return m, nil

		case key.Matches(msg, m.keys.Submit):
			return m.handleEnter(msg)
		}

	case displayChangeMsg:
		m.syncState()
		return m, nil

	case tokenUpdateMsg:
		m.Status.tokenCount = msg.total
		return m, nil

	case agentDoneMsg:
		m.Input.streaming = false
		m.Status.streaming = false
		if msg.err != nil {
			m.Status.err = msg.err
			m.agent.Store().AddStatus(domain.RoleError, msg.err.Error())
		}
		m.syncState()
		return m, nil

	case tea.WindowSizeMsg:
		m.width = msg.Width
		m.height = msg.Height
		m.ready = true

	case spinner.TickMsg:
		var cmd tea.Cmd
		m.Input.spinner, cmd = m.Input.spinner.Update(msg)
		cmds = append(cmds, cmd)
	}

	var cmd tea.Cmd
	m.Viewport.viewport, cmd = m.Viewport.viewport.Update(msg)
	cmds = append(cmds, cmd)

	return m, tea.Batch(cmds...)
}

// ---- Helpers ----

func (m *TUIModel) syncState() {
	m.Viewport.messages = ToDisplayMessages(m.agent.Store().Turns(), m.agent.Store().Statuses(), m.agent.Store().IsStreaming())
	m.Input.streaming = m.agent.Store().IsStreaming()
	m.Status.streaming = m.Input.streaming
	m.Status.modelName = m.agent.Model()
	m.Status.session = m.agent.SessionName()
	m.Status.tokenCount = m.agent.TokenCount()
	m.Viewport.viewport.SetContent(m.Viewport.Render())
	m.Viewport.viewport.GotoBottom()
}

func (m *TUIModel) handleEnter(msg tea.KeyMsg) (tea.Model, tea.Cmd) {
	input := strings.TrimSpace(m.Input.textarea.Value())
	if input == "" {
		return m, nil
	}
	m.Input.textarea.Reset()
	m.Input.Suggest.Clear()

	promptText := input
	isPrompt := false
	if len(input) > 0 && input[0] == '/' && m.cmdReg != nil {
		cfg, _ := config.Load()
		cmdCtx := icmd.Context{
			Agent:    m.agent,
			Config:   cfg,
			Sessions: storage.NewSessionManager().List(),
		}
		handled, result, expanded := m.cmdReg.ParseAndExecute(input, cmdCtx)
		if handled {
			if expanded != "" {
				isPrompt = true
				promptText = expanded
			} else if result != nil {
				switch r := result.(type) {
				case icmd.ExitResult:
					return m, tea.Quit
				case icmd.StatusResult:
					if r.IsError {
						m.agent.Store().AddStatus(domain.RoleError, r.Message)
					} else {
						m.agent.Store().AddStatus(domain.RoleStatus, r.Message)
					}
					return m, nil
				case icmd.SelectResult:
					m.Select.SetMode(r.Mode, r.Title, r.Items)
					return m, nil
				case icmd.SetInputResult:
					m.Input.textarea.SetValue(r.Value)
					return m, nil
				}
			}
			if !isPrompt {
				return m, nil
			}
		}
	}

	cmd := func() tea.Msg {
		_, err := m.agent.Run(context.Background(), promptText, input)
		if err != nil && errors.Is(err, context.Canceled) {
			err = nil
		}
		return agentDoneMsg{err: err}
	}
	return m, cmd
}

func (m *TUIModel) handleSelectChoice(val string) {
	switch m.Select.mode {
	case "effort-select":
		config.SetEffort(val)
		m.agent.SetEffort(val)
		m.agent.Store().AddStatus(domain.RoleStatus, "Effort set to: "+val)
	case "session-list":
		if err := m.agent.LoadSession(val); err != nil {
			m.agent.Store().AddStatus(domain.RoleError, "Session not found: "+val)
			return
		}
		m.Status.session = val
		m.Viewport.messages = ToDisplayMessages(m.agent.Store().Turns(), m.agent.Store().Statuses(), m.agent.Store().IsStreaming())
		m.Status.tokenCount = m.agent.TokenCount()
		m.Viewport.viewport.SetContent(m.Viewport.Render())
		m.Viewport.viewport.GotoBottom()
		m.agent.Store().AddStatus(domain.RoleStatus, "Loaded session: "+val)
	case "model-tier":
		if items := m.Select.handleModelTier(val); items != nil {
			m.Select.SetMode("model-edit-tier", "Edit which tier?", items)
			return
		}
		cfg, _ := config.Load()
		spec := ""
		if cfg.Tiers != nil {
			spec = cfg.Tiers[val]
		}
		if spec == "" {
			return
		}
		modelName, apiKey, baseURL, ctxLen := applyModelSpec(spec)
		m.agent.SetModel(spec, apiKey, baseURL, ctxLen)
		config.SetModel(spec)
		m.Status.modelName = modelName
	case "model-edit-tier":
		m.Select.wizardEditTier = val
		items := m.Select.buildProviderItems()
		if len(items) == 0 {
			m.agent.Store().AddStatus(domain.RoleError, "No configured providers found")
			return
		}
		m.Select.SetMode("model-provider", "Provider for Tier "+val+":", items)
		return
	case "model-provider":
		m.Select.wizardProvider = val
		items := m.Select.buildModelItems(val)
		if len(items) == 0 {
			m.agent.Store().AddStatus(domain.RoleError, "No models configured for "+val)
			return
		}
		m.Select.SetMode("model-model", "Model for Tier "+m.Select.wizardEditTier+" @"+val+":", items)
		return
	case "model-model":
		spec := val + "@" + m.Select.wizardProvider
		config.SetTier(m.Select.wizardEditTier, spec)
		modelName, apiKey, baseURL, ctxLen := applyModelSpec(spec)
		m.agent.SetModel(spec, apiKey, baseURL, ctxLen)
		config.SetModel(spec)
		m.Status.modelName = modelName
		m.agent.Store().AddStatus(domain.RoleStatus, "Tier "+m.Select.wizardEditTier+" -> "+spec)
	}
	m.Select.ClearMode()
}

// ---- TUI entry point ----

// RunTUI starts the interactive Bubble Tea terminal UI.
func RunTUI(ag *agent.Agent, promptFiles []string) error {
	mdl := NewTUIModel(ag, promptFiles)
	p := tea.NewProgram(mdl)
	mdl.program = p
	_, err := p.Run()
	return err
}

// ---- View ----

// View is the Bubble Tea View function.
func (m *TUIModel) View() string {
	if !m.ready {
		return "Initializing...\n"
	}

	header := m.Header.View(m.width)
	viewport := m.Viewport.viewport.View()
	input := m.Input.View(m.width)
	status := m.Status.View(m.agent, m.width)
	helpView := m.help.View(m.keys)

	// When select mode is active, input area shows the list instead
	if m.Select.Active() {
		input = m.Select.list.View()
	}

	return header + viewport + "\n" + input + status + helpView + "\n"
}
