package tui

import (
	"context"
	"errors"
	"strings"

	"github.com/charmbracelet/bubbles/spinner"
	tea "github.com/charmbracelet/bubbletea"
	"minicode/internal/config"
	icmd "minicode/internal/commands"
	"minicode/internal/domain"
	"minicode/internal/storage"
)

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
		consumed, inputCmd := m.Input.Update(msg, m.cmdReg)
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

		switch msg.Type {
		case tea.KeyCtrlC:
			if m.Input.streaming {
				m.agent.Abort()
				return m, nil
			}
			return m, tea.Quit

		case tea.KeyEsc:
			if m.Input.streaming {
				m.agent.Abort()
			}
			return m, nil

		case tea.KeyShiftTab:
			if p := m.agent.PermissionSvc(); p != nil {
				p.CycleMode()
			}
			return m, nil

		case tea.KeyEnter:
			input := strings.TrimSpace(m.Input.textarea.Value())
			if input == "" {
				return m, nil
			}
			m.Input.textarea.Reset()
			m.Input.Suggest.Clear()

			cmdInput := input
			promptText := input
			isHandled := false
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
					isHandled = true
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
						case icmd.SelectResult:
							m.Select.setMode(r.Mode, r.Title, r.Items, m.width, m.height)
						case icmd.SetInputResult:
							m.Input.textarea.SetValue(r.Value)
						}
					}
				}
			}

			if isHandled && !isPrompt {
				return m, nil
			}

			cmd := func() tea.Msg {
				_, err := m.agent.Run(context.Background(), promptText, cmdInput)
				if err != nil && errors.Is(err, context.Canceled) {
					err = nil
				}
				return agentDoneMsg{err: err}
			}
			return m, cmd

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
		m.Viewport.viewport.Width = msg.Width - 4
		m.Viewport.viewport.Height = msg.Height - 3 - 6
		m.Input.textarea.SetWidth(msg.Width - 4)
		m.Status.prog.Width = msg.Width - 20
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

// syncState refreshes all sub-models from the agent's current state.
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

// handleSelectChoice dispatches a selection from the bubbles/list UI.
func (m *TUIModel) handleSelectChoice(val string) {
	switch m.Select.mode {
	case "effort-select":
		config.SetEffort(val)
		m.agent.SetEffort(val)
		m.agent.Store().AddStatus(domain.RoleStatus, "Effort set to: "+val)
		m.Select.clearMode()
	case "session-list":
		m.Select.clearMode()
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
			m.Select.setMode("model-edit-tier", "Edit which tier?", items, m.width, m.height)
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
		modelName, apiKey, baseURL, ctxLen := applyModelSpecFn(spec)
		m.agent.SetModel(spec, apiKey, baseURL, ctxLen)
		config.SetModel(spec)
		m.Status.modelName = modelName
		m.Select.clearMode()
	case "model-edit-tier":
		m.Select.wizardEditTier = val
		items := m.Select.buildProviderItems()
		if len(items) == 0 {
			m.agent.Store().AddStatus(domain.RoleError, "No configured providers found")
			m.Select.clearMode()
			return
		}
		m.Select.setMode("model-provider", "Provider for Tier "+val+":", items, m.width, m.height)
	case "model-provider":
		m.Select.wizardProvider = val
		items := m.Select.buildModelItems(val)
		if len(items) == 0 {
			m.agent.Store().AddStatus(domain.RoleError, "No models configured for "+val)
			m.Select.clearMode()
			return
		}
		m.Select.setMode("model-model", "Model for Tier "+m.Select.wizardEditTier+" @"+val+":", items, m.width, m.height)
	case "model-model":
		spec := val + "@" + m.Select.wizardProvider
		config.SetTier(m.Select.wizardEditTier, spec)
		modelName, apiKey, baseURL, ctxLen := applyModelSpecFn(spec)
		m.agent.SetModel(spec, apiKey, baseURL, ctxLen)
		config.SetModel(spec)
		m.Status.modelName = modelName
		m.agent.Store().AddStatus(domain.RoleStatus, "Tier "+m.Select.wizardEditTier+" -> "+spec)
		m.Select.clearMode()
	}
}
