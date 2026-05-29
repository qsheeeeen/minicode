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
)

// TuiModel is the top-level Bubble Tea model composed of sub-models.
type TuiModel struct {
	agent    *agent.Agent
	Header   HeaderModel
	Input    InputModel
	Viewport ViewportModel
	Panel    PanelModel
	Status   StatusModel
	Select   SelectModel

	keys TUIKeyMap
	help help.Model

	// Channels for external goroutine → TUI communication.
	displayCh chan struct{}
	tokenCh   chan int
	askCh     chan askPromptMsg
	permCh    chan permPromptMsg

	width  int
	height int
	ready  bool
}

// NewTuiModel creates the TUI model.
func NewTuiModel(ag *agent.Agent, promptFiles []string) *TuiModel {
	m := &TuiModel{
		agent:     ag,
		keys:      DefaultKeyMap(),
		help:      help.New(),
		displayCh: make(chan struct{}, 1),
		tokenCh:   make(chan int, 1),
		askCh:     make(chan askPromptMsg, 1),
		permCh:    make(chan permPromptMsg, 1),
	}

	// Input
	m.Input.textarea = textarea.New()
	m.Input.textarea.Placeholder = "Type a message or /command..."
	m.Input.textarea.ShowLineNumbers = false
	m.Input.textarea.Focus()

	m.Status = NewStatusModel()

	// Viewport
	m.Viewport.viewport = viewport.New(80, 20)
	m.Viewport.messages = ToDisplayMessages(ag.Store().Turns(), ag.Store().Statuses(), ag.Store().IsStreaming())

	// Panel
	m.Panel.prog = progress.New(progress.WithDefaultGradient())
	m.Panel.modelName = ag.Model()
	m.Panel.session = ag.SessionName()

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

	// Callbacks — write to channels, never block the caller.
	ag.OnDisplayChange(func() {
		select {
		case m.displayCh <- struct{}{}:
		default: // drop if already pending
		}
	})

	ag.OnTokenUpdate(func(total int) {
		select {
		case m.tokenCh <- total:
		default:
		}
	})

	ag.SetAskUserFn(func(question string, options []domain.AskOption, multi bool) string {
		ch := make(chan string, 1)
		m.askCh <- askPromptMsg{
			question: question,
			options:  options,
			multi:    multi,
			resolve:  ch,
		}
		return <-ch
	})

	if p := ag.PermissionSvc(); p != nil {
		if ps, ok := p.(*services.PermissionService); ok {
			ps.SetPromptFn(func(displayText string) string {
				ch := make(chan string, 1)
				m.permCh <- permPromptMsg{displayText: displayText, resolve: ch}
				return <-ch
			})
		}
	}

	return m
}

// Init is the Bubble Tea Init function.
func (m *TuiModel) Init() tea.Cmd {
	return tea.Batch(
		textarea.Blink,
		m.Status.spinner.Tick,
		listenDisplay(m.displayCh),
		listenToken(m.tokenCh),
		listenAsk(m.askCh),
		listenPerm(m.permCh),
	)
}

// listenDisplay returns a Cmd that waits for display change notifications.
func listenDisplay(ch <-chan struct{}) tea.Cmd {
	return func() tea.Msg {
		<-ch
		return displayChangeMsg{}
	}
}

// listenToken returns a Cmd that waits for token count updates.
func listenToken(ch <-chan int) tea.Cmd {
	return func() tea.Msg {
		return tokenUpdateMsg{total: <-ch}
	}
}

// listenAsk returns a Cmd that waits for ask-user prompts.
func listenAsk(ch <-chan askPromptMsg) tea.Cmd {
	return func() tea.Msg {
		return <-ch
	}
}

// listenPerm returns a Cmd that waits for permission prompts.
func listenPerm(ch <-chan permPromptMsg) tea.Cmd {
	return func() tea.Msg {
		return <-ch
	}
}

// Update is the Bubble Tea Update function.
func (m *TuiModel) Update(msg tea.Msg) (tea.Model, tea.Cmd) {
	var cmds []tea.Cmd

	switch msg := msg.(type) {
	case permPromptMsg:
		m.Input.Perm.Activate(msg.displayText, msg.resolve)
		return m, listenPerm(m.permCh)

	case askPromptMsg:
		m.Input.Ask.Activate(msg.question, msg.options, msg.multi, msg.resolve)
		return m, listenAsk(m.askCh)

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
		return m, listenDisplay(m.displayCh)

	case tokenUpdateMsg:
		m.Panel.tokenCount = msg.total
		return m, listenToken(m.tokenCh)

	case agentDoneMsg:
		m.Input.streaming = false
		m.Panel.streaming = false
		m.Status.streaming = false
		if msg.err != nil {
			m.Panel.err = msg.err
			m.agent.Store().AddStatus(domain.RoleError, msg.err.Error())
		}
		m.syncState()
		return m, nil

	case tea.WindowSizeMsg:
		m.width = msg.Width
		m.height = msg.Height
		m.ready = true

	case spinner.TickMsg:
		cmds = append(cmds, m.Status.Update(msg))
	}

	var cmd tea.Cmd
	m.Viewport.viewport, cmd = m.Viewport.viewport.Update(msg)
	cmds = append(cmds, cmd)

	return m, tea.Batch(cmds...)
}

// View is the Bubble Tea View function.
func (m *TuiModel) View() string {
	if !m.ready {
		return "Initializing...\n"
	}

	header := m.Header.View()
	viewport := m.Viewport.viewport.View()
	input := m.Input.View()
	status := m.Status.View()
	panel := m.Panel.View(m.agent)
	helpView := m.help.View(m.keys)

	// When select mode is active, input area shows the list instead
	if m.Select.Active() {
		input = m.Select.list.View()
	}

	return header + viewport + "\n" + status + "\n" + input + panel + helpView + "\n"
}

// ---- Helpers ----

func (m *TuiModel) syncState() {
	m.Viewport.messages = ToDisplayMessages(m.agent.Store().Turns(), m.agent.Store().Statuses(), m.agent.Store().IsStreaming())
	m.Input.streaming = m.agent.Store().IsStreaming()
	m.Panel.streaming = m.Input.streaming
	m.Status.streaming = m.Input.streaming
	m.Panel.modelName = m.agent.Model()
	m.Panel.session = m.agent.SessionName()
	m.Panel.tokenCount = m.agent.TokenCount()
	m.Viewport.viewport.SetContent(m.Viewport.Render())
	m.Viewport.viewport.GotoBottom()
}

func (m *TuiModel) handleEnter(msg tea.KeyMsg) (tea.Model, tea.Cmd) {
	input := strings.TrimSpace(m.Input.textarea.Value())
	if input == "" {
		return m, nil
	}
	m.Input.textarea.Reset()
	m.Input.Suggest.Clear()

	promptText := input
	isPrompt := false
	if len(input) > 0 && input[0] == '/' {
		cfg, _ := config.Load()
		cmdCtx := icmd.Context{
			Agent:    m.agent,
			Config:   cfg,
			Sessions: storage.NewSessionManager().List(),
		}
		handled, result, expanded := icmd.ParseAndExecute(input, cmdCtx)
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

func (m *TuiModel) handleSelectChoice(val string) {
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
		m.Panel.session = val
		m.Viewport.messages = ToDisplayMessages(m.agent.Store().Turns(), m.agent.Store().Statuses(), m.agent.Store().IsStreaming())
		m.Panel.tokenCount = m.agent.TokenCount()
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
		m.Panel.modelName = modelName
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
		m.Panel.modelName = modelName
		m.agent.Store().AddStatus(domain.RoleStatus, "Tier "+m.Select.wizardEditTier+" -> "+spec)
	}
	m.Select.ClearMode()
}

// RunTUI starts the interactive Bubble Tea terminal UI.
func RunTUI(ag *agent.Agent, promptFiles []string) error {
	mdl := NewTuiModel(ag, promptFiles)
	p := tea.NewProgram(mdl)
	_, err := p.Run()
	return err
}
