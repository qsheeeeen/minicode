package tui

import (
	"context"
	"errors"
	"strings"
	"github.com/charmbracelet/bubbles/list"
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
	case sessionUpdateMsg:
		m.sessions = msg.sessions
		return m, nil

	case permPromptMsg:
		m.permPending = true
		m.permText = msg.displayText
		m.permResolve = msg.resolve
		return m, nil

	case askPromptMsg:
		m.askPending = true
		m.askQuestion = msg.question
		m.askOptions = msg.options
		m.askMulti = msg.multi
		m.askSelected = make([]bool, len(msg.options))
		m.askCurrent = 0
		m.askResolve = msg.resolve
		return m, nil

	case tea.KeyMsg:
		if m.permPending {
			return m.handlePermKey(msg)
		}
		if m.askPending {
			return m.handleAskKey(msg)
		}
		if m.selectMode != "" {
			switch msg.Type {
			case tea.KeyEsc:
				m.clearMode()
				return m, nil
			case tea.KeyEnter:
				if i, ok := m.selectList.SelectedItem().(list.DefaultItem); ok {
					m.handleSelectChoice(i.Title())
				}
				return m, nil
			}
			var cmd tea.Cmd
			m.selectList, cmd = m.selectList.Update(msg)
			return m, cmd
		}

		if len(m.suggestions) > 0 {
			switch msg.Type {
			case tea.KeyTab:
				m.input.SetValue("/" + m.suggestions[m.selectedIdx].Name + " ")
				m.suggestions = nil
				m.selectedIdx = 0
				return m, nil
			case tea.KeyUp:
				m.selectedIdx = (m.selectedIdx - 1 + len(m.suggestions)) % len(m.suggestions)
				return m, nil
			case tea.KeyDown:
				m.selectedIdx = (m.selectedIdx + 1) % len(m.suggestions)
				return m, nil
			case tea.KeyEsc:
				m.suggestions = nil
				m.selectedIdx = 0
				return m, nil
			}
		}

		switch msg.Type {
		case tea.KeyCtrlC:
			if m.streaming {
				m.agent.Abort()
				return m, nil
			}
			return m, tea.Quit

		case tea.KeyEsc:
			if m.streaming {
				m.agent.Abort()
			}
			return m, nil

		case tea.KeyShiftTab:
			if p := m.agent.PermissionSvc(); p != nil {
				p.CycleMode()
			}
			return m, nil

		case tea.KeyEnter:
			input := strings.TrimSpace(m.input.Value())
			if input == "" {
				return m, nil
			}
			m.input.Reset()
			m.suggestions = nil
			m.selectedIdx = 0

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
							m.setMode(r.Mode, r.Title, r.Items)
						case icmd.SetInputResult:
							m.input.SetValue(r.Value)
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

		case tea.KeyCtrlO:
			// Multi-agent switching: cycle through registered agents
			if m.agentRegistry != nil && len(m.sessions) > 1 {
				next := m.agentRegistry.NextActive()
				if next != nil {
					m.agent = next
					m.activeID = next.ID()
					m.messages = ToDisplayMessages(next.Store().Turns(), next.Store().Statuses(), next.Store().IsStreaming())
					m.streaming = next.Store().IsStreaming()
					m.tokenCount = next.TokenCount()
					m.modelName = next.Model()
					m.session = next.SessionName()
					
					next.OnDisplayChange(func() {
						if m.program != nil {
							m.program.Send(displayChangeMsg{})
						}
					})
					next.OnTokenUpdate(func(total int) {
						if m.program != nil {
							m.program.Send(tokenUpdateMsg{total: total})
						}
					})
					
					m.viewport.SetContent(m.renderMessages())
					m.viewport.GotoBottom()
				}
			}
			return m, nil

		default:
			// Only update input when not streaming
			if !m.streaming {
				var cmd tea.Cmd
				m.input, cmd = m.input.Update(msg)
				cmds = append(cmds, cmd)

				// Update suggestions
				val := m.input.Value()
				if len(val) > 0 && val[0] == '/' && m.cmdReg != nil {
					partial := strings.ToLower(val[1:])
					all := m.cmdReg.List()
					var filtered []icmd.Command
					for _, c := range all {
						if strings.HasPrefix(strings.ToLower(c.Name), partial) {
							filtered = append(filtered, c)
						}
					}
					m.suggestions = filtered
					if m.selectedIdx >= len(m.suggestions) {
						m.selectedIdx = 0
					}
				} else {
					m.suggestions = nil
					m.selectedIdx = 0
				}
			}
		}

	case displayChangeMsg:
		m.messages = ToDisplayMessages(m.agent.Store().Turns(), m.agent.Store().Statuses(), m.agent.Store().IsStreaming())
		m.streaming = m.agent.Store().IsStreaming()
		m.modelName = m.agent.Model()
		m.session = m.agent.SessionName()
		m.tokenCount = m.agent.TokenCount()
		m.viewport.SetContent(m.renderMessages())
		m.viewport.GotoBottom()
		return m, nil

	case tokenUpdateMsg:
		m.tokenCount = msg.total
		return m, nil

	case agentDoneMsg:
		m.streaming = false
		if msg.err != nil {
			m.err = msg.err
			m.agent.Store().AddStatus(domain.RoleError, msg.err.Error())
		}
		m.messages = ToDisplayMessages(m.agent.Store().Turns(), m.agent.Store().Statuses(), m.agent.Store().IsStreaming())
		m.modelName = m.agent.Model()
		m.session = m.agent.SessionName()
		m.viewport.SetContent(m.renderMessages())
		m.viewport.GotoBottom()
		return m, nil

	case tea.WindowSizeMsg:
		m.width = msg.Width
		m.height = msg.Height
		headerHeight := 3
		footerHeight := 6
		m.viewport.Width = msg.Width - 4
		m.viewport.Height = msg.Height - headerHeight - footerHeight
		m.input.SetWidth(msg.Width - 4)
		m.prog.Width = msg.Width - 20
		m.ready = true

	case spinner.TickMsg:
		var cmd tea.Cmd
		m.spinner, cmd = m.spinner.Update(msg)
		cmds = append(cmds, cmd)
	}

	var cmd tea.Cmd
	m.viewport, cmd = m.viewport.Update(msg)
	cmds = append(cmds, cmd)

	return m, tea.Batch(cmds...)
}
