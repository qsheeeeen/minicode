package ui

import (
	"context"
	"fmt"
	"strings"

	"github.com/charmbracelet/bubbles/help"
	"github.com/charmbracelet/bubbles/list"
	"github.com/charmbracelet/bubbles/progress"
	"github.com/charmbracelet/bubbles/spinner"
	"github.com/charmbracelet/bubbles/textarea"
	"github.com/charmbracelet/bubbles/viewport"
	tea "github.com/charmbracelet/bubbletea"
	"github.com/charmbracelet/lipgloss"

	"minicode/internal/agent"
	"minicode/internal/config"
	"minicode/internal/domain"
	"minicode/internal/storage"
	"minicode/internal/tools"
)

// ---- Styles ----

// Version is the application version, set at build time via ldflags.
var Version = "0.1.0"

var (
	styleHeaderCyan = lipgloss.NewStyle().Foreground(lipgloss.Color("6")).Bold(true)  // cyan
	styleDim        = lipgloss.NewStyle().Foreground(lipgloss.Color("8"))             // grey/dim
	styleGreen      = lipgloss.NewStyle().Foreground(lipgloss.Color("2"))             // green
	styleMagenta    = lipgloss.NewStyle().Foreground(lipgloss.Color("5"))             // magenta
	styleYellow     = lipgloss.NewStyle().Foreground(lipgloss.Color("3"))             // yellow
	styleRed        = lipgloss.NewStyle().Foreground(lipgloss.Color("1"))             // red

	styleUserBg     = lipgloss.NewStyle().Background(lipgloss.Color("8")).Foreground(lipgloss.Color("15")).Bold(true).Padding(0, 1)
	styleToolCall   = lipgloss.NewStyle().Foreground(lipgloss.Color("3"))             // yellow
	styleThinking   = lipgloss.NewStyle().Foreground(lipgloss.Color("8")).Italic(true)
	styleErrorMsg   = lipgloss.NewStyle().Foreground(lipgloss.Color("1")).Bold(true)  // red bold

	styleInputBorder = lipgloss.NewStyle().Border(lipgloss.NormalBorder()).BorderForeground(lipgloss.Color("8")).Padding(0, 1)
	styleInputArrow  = lipgloss.NewStyle().Foreground(lipgloss.Color("6")).Bold(true)  // cyan
)

// ---- Messages ----

type displayChangeMsg struct{}

type tokenUpdateMsg struct {
	total int
}

type agentDoneMsg struct {
	err error
}

type setModeMsg struct {
	mode  string
	title string
	items []list.Item
}

type permPromptMsg struct {
	displayText string
	resolve     chan string
}

type sessionUpdateMsg struct {
	sessions []agent.AgentSession
}

type askPromptMsg struct {
	question string
	options  []domain.AskOption
	multi    bool
	resolve  chan string
}

// ---- Model ----

// TUIModel is the top-level Bubble Tea model.
type TUIModel struct {
	program       *tea.Program
	agent         *agent.Agent
	agentRegistry *agent.AgentRegistry
	cmdReg        *CommandRegistry
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
	suggestions []Command
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
func NewTUIModel(ag *agent.Agent, registry *agent.AgentRegistry, cmdReg *CommandRegistry, promptFiles []string) *TUIModel {
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

	case setModeMsg:
		m.setMode(msg.mode, msg.title, msg.items)
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
				ctx := CommandContext{
					Agent: m.agent,
					ExitFn: func() {
						if m.program != nil {
							m.program.Quit()
						}
					},
					ClearFn: m.agent.ClearSession,
					CompressFn: func() {
						m.agent.Compress()
					},
					SetSessionFn: func(name string) {
						m.session = name
						m.agent.SetSession(name)
					},
					ListSkillsFn: func() string {
						if sk := m.agent.Skills(); sk != nil {
							infos := sk.List()
							if len(infos) == 0 {
								return "No skills loaded"
							}
							var names []string
							for _, info := range infos {
								names = append(names, info.Name+": "+info.Description)
							}
							return strings.Join(names, "\n")
						}
						return "No skills loaded"
					},
					SetSelectModeFn: func(mode, title string, items []list.Item) {
						if m.program != nil {
							m.program.Send(setModeMsg{mode: mode, title: title, items: items})
						}
					},
					SetInputValueFn: func(value string) {
						m.input.SetValue(value)
					},
					SetStatusFn: func(content string) {
						m.agent.Store().AddStatus(domain.RoleStatus, content)
					},
					GetConfigFn: func() *config.Config {
						cfg, _ := config.Load()
						return cfg
					},
					LoadSessionFn: func(name string) {
						if err := m.agent.LoadSession(name); err != nil {
							m.agent.Store().AddStatus(domain.RoleError, fmt.Sprintf("Session not found: %s", name))
							return
						}
						m.session = name
						m.messages = ToDisplayMessages(m.agent.Store().Turns(), m.agent.Store().Statuses(), m.agent.Store().IsStreaming())
						m.tokenCount = m.agent.TokenCount()
						m.viewport.SetContent(m.renderMessages())
						m.viewport.GotoBottom()
						m.agent.Store().AddStatus(domain.RoleStatus, fmt.Sprintf("Loaded session: %s", name))
					},
					ListSessionsFn: func() string {
						sm := storage.NewSessionManager()
						sessions := sm.List()
						var items []list.Item
						for _, s := range sessions {
							items = append(items, listItem{title: s.Name, desc: s.Timestamp.Format("2006-01-02 15:04")})
						}
						if len(items) == 0 {
							m.agent.Store().AddStatus(domain.RoleStatus, "No sessions found")
							return ""
						}
						if m.program != nil {
							m.program.Send(setModeMsg{mode: "session-list", title: "Sessions:", items: items})
						}
						return ""
					},
					RenameSessionFn: func(oldName, newName string) error {
						sm := storage.NewSessionManager()
						if err := sm.Rename(oldName, newName); err != nil {
							return err
						}
						m.session = newName
						m.agent.SetSession(newName)
						return nil
					},
					SessionInfos: func() []storage.SessionInfo {
						sm := storage.NewSessionManager()
						return sm.List()
					}(),
				}
				handled, expanded := m.cmdReg.ParseAndExecute(input, ctx)
				if handled {
					isHandled = true
					if expanded != "" {
						isPrompt = true
						promptText = expanded
					}
				}
			}

			if isHandled && !isPrompt {
				return m, nil
			}

			cmd := func() tea.Msg {
				_, err := m.agent.Run(context.Background(), promptText, cmdInput)
				if err != nil && err.Error() == "context canceled" {
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
					var filtered []Command
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

func (m *TUIModel) handleAskKey(msg tea.KeyMsg) (tea.Model, tea.Cmd) {
	switch msg.Type {
	case tea.KeyUp:
		m.askCurrent = (m.askCurrent - 1 + len(m.askOptions)) % len(m.askOptions)
	case tea.KeyDown:
		m.askCurrent = (m.askCurrent + 1) % len(m.askOptions)
	case tea.KeySpace:
		if m.askMulti {
			m.askSelected[m.askCurrent] = !m.askSelected[m.askCurrent]
		}
	case tea.KeyEnter:
		var result string
		if m.askMulti {
			var selected []string
			for i, s := range m.askSelected {
				if s {
					selected = append(selected, m.askOptions[i].Label)
				}
			}
			result = strings.Join(selected, ",")
		} else {
			result = m.askOptions[m.askCurrent].Label
		}
		m.askPending = false
		if m.askResolve != nil {
			m.askResolve <- result
		}
	case tea.KeyEsc:
		m.askPending = false
		if m.askResolve != nil {
			m.askResolve <- ""
		}
	}
	return m, nil
}

func (m *TUIModel) handlePermKey(msg tea.KeyMsg) (tea.Model, tea.Cmd) {
	var res string
	switch msg.String() {
	case "y":
		res = "yes"
	case "n", "esc":
		res = "no"
	case "a":
		res = "yolo"
	default:
		return m, nil
	}

	m.permPending = false
	if m.permResolve != nil {
		m.permResolve <- res
	}
	return m, nil
}

// View is the Bubble Tea View function.
func (m *TUIModel) View() string {
	if !m.ready {
		return "Initializing...\n"
	}

	header := m.renderHeader()
	viewport := m.viewport.View()
	input := m.renderInput()
	status := m.renderStatusBar()

	return lipgloss.JoinVertical(lipgloss.Left,
		header,
		viewport,
		input,
		status,
	)
}

func (m *TUIModel) renderHeader() string {
	var agentStr string
	if len(m.sessions) > 1 {
		indicator := m.activeID
		if indicator == "1" {
			indicator = "M"
		}
		agentStr = "\n" + styleHeaderCyan.Render(fmt.Sprintf("[%s]", indicator))
	}

	line1 := styleHeaderCyan.Render("Mini Code") + styleDim.Render(" v"+Version)
	if len(m.promptFiles) > 0 {
		line1 += styleDim.Render(" | " + strings.Join(m.promptFiles, ", "))
	}
	return line1 + agentStr + "\n"
}

func (m *TUIModel) activeAgentId() string {
	return m.activeID
}

func (m *TUIModel) renderInput() string {
	if m.permPending {
		return styleToolCall.Render(fmt.Sprintf("[Permission] %s [y=yes / n=no / a=yes to all]", m.permText))
	}

	if m.askPending {
		// Yellow round border for question (matches TS)
		questionBox := lipgloss.NewStyle().Border(lipgloss.RoundedBorder()).BorderForeground(lipgloss.Color("3")).Padding(0, 1).Render(m.askQuestion)

		// Align option labels to same width
		maxLabel := 0
		for _, opt := range m.askOptions {
			if len(opt.Label) > maxLabel {
				maxLabel = len(opt.Label)
			}
		}
		var optLines []string
		for i, opt := range m.askOptions {
			arrow := "  "
			label := styleDim.Render(opt.Label)
			if i == m.askCurrent {
				arrow = styleInputArrow.Render("> ")
				label = styleHeaderCyan.Render(opt.Label)
			}
			marker := ""
			if m.askMulti {
				chk := " "
				if m.askSelected[i] {
					chk = "x"
				}
				marker = "[" + chk + "] "
			}
			desc := ""
			if opt.Description != "" {
				desc = "  " + styleDim.Render(opt.Description)
			}
			optLines = append(optLines, fmt.Sprintf("%s%s%s%s", arrow, marker, label, desc))
		}
		footer := styleDim.Render("↑↓ navigate")
		if m.askMulti {
			footer += styleDim.Render("  Space toggle")
		}
		footer += styleDim.Render("  Enter accept  Esc cancel")

		// Gray single border for options (matches TS)
		selectBox := lipgloss.NewStyle().Border(lipgloss.NormalBorder()).BorderForeground(lipgloss.Color("8")).Padding(0, 1).Render(
			strings.Join(optLines, "\n") + "\n" + footer,
		)

		return questionBox + "\n" + selectBox
	}

	// Mode: select UI using bubbles/list
	if m.selectMode != "" {
		return m.selectList.View()
	}

	prefix := styleInputArrow.Render("> ")
	if m.streaming {
		prefix = m.spinner.View() + " "
	}

	inputView := prefix + m.input.View()
	mainInput := styleInputBorder.Width(m.width - 2).Render(inputView)

	if len(m.suggestions) > 0 && !m.streaming {
		var lines []string
		for i, s := range m.suggestions {
			arrow := "  "
			style := styleDim
			if i == m.selectedIdx {
				arrow = styleInputArrow.Render("> ")
				style = styleHeaderCyan
			}
			desc := s.Description
			if idx := strings.Index(desc, "\n"); idx != -1 {
				desc = desc[:idx]
			}
			line := fmt.Sprintf("%s%s %s", arrow, style.Render("/"+s.Name), styleDim.Render(desc))
			lines = append(lines, line)
		}
		suggestions := "\n" + strings.Join(lines, "\n") + "\n " + styleDim.Render("↑↓ navigate  Tab accept")
		return mainInput + suggestions
	}

	return mainInput
}

func (m *TUIModel) renderStatusBar() string {
	provider := m.agent.Provider()
	if provider == "" {
		provider = "unknown"
	}
	line1 := styleGreen.Render(provider) + styleDim.Render(":") + m.modelName + styleDim.Render(" | "+m.session)
	if m.err != nil {
		line1 += styleDim.Render(" | ") + styleErrorMsg.Render("ERR: "+m.err.Error())
	} else if m.streaming {
		line1 += styleDim.Render(" | ") + styleMagenta.Render("streaming")
	}

	ctxLen := m.agent.ContextLength()
	if ctxLen == 0 {
		ctxLen = 200000
	}
	pct := float64(m.tokenCount) / float64(ctxLen) * 100
	if pct > 100 {
		pct = 100
	}

	permMode := "manual"
	if p := m.agent.PermissionSvc(); p != nil {
		permMode = string(p.Mode())
	}

	modeColor := styleYellow
	if permMode == "yolo" {
		modeColor = styleRed
	} else if permMode == "auto" {
		modeColor = styleHeaderCyan
	}

	line2 := styleDim.Render(fmt.Sprintf("%d/%d ", m.tokenCount, ctxLen)) +
		m.prog.ViewAs(pct/100) +
		styleDim.Render(fmt.Sprintf(" %d%% │ ", int(pct))) +
		modeColor.Render(permMode) +
		styleDim.Render(" (Shift+Tab)")

	return line1 + "\n" + line2
}

func (m *TUIModel) renderMessages() string {
	if len(m.messages) == 0 {
		return "\n\n" + styleDim.Render("Type a message to start...") + "\n"
	}

	var lines []string
	for _, msg := range m.messages {
		// Match TS filtering: tool always, status only if (not applicable in Go), others only if content
		if msg.Role != domain.RoleTool && msg.Role != domain.RoleStatus && msg.Role != domain.RoleError && msg.Content == "" {
			continue
		}
		switch msg.Role {
		case domain.RoleUser:
			lines = append(lines, styleUserBg.Render(strings.TrimSpace(msg.Content)))
			lines = append(lines, "")
		case domain.RoleText:
			lines = append(lines, strings.TrimSpace(msg.Content))
			lines = append(lines, "")
		case domain.RoleThinking:
			lines = append(lines, styleThinking.Render("Thinking"))
			lines = append(lines, styleDim.Render(strings.TrimSpace(msg.Content)))
			lines = append(lines, "")
		case domain.RoleTool:
			var call string
			if msg.ToolName == "Read" {
				path, _ := msg.ToolInput["path"].(string)
				parts := []string{path}
				if offset, ok := msg.ToolInput["offset"].(float64); ok && offset > 0 {
					parts = append(parts, fmt.Sprintf("offset: %.0f", offset))
				}
				if limit, ok := msg.ToolInput["limit"].(float64); ok && limit > 0 {
					parts = append(parts, fmt.Sprintf("limit: %.0f", limit))
				}
				call = fmt.Sprintf("Read(%s)", strings.Join(parts, ", "))
			} else if msg.ToolName == "Write" {
				path, _ := msg.ToolInput["path"].(string)
				content, _ := msg.ToolInput["content"].(string)
				lines := 0
				if content != "" {
					lines = len(strings.Split(content, "\n"))
				}
				call = fmt.Sprintf("Write(%s, %d lines)", path, lines)
			} else if msg.ToolName == "Edit" {
				path, _ := msg.ToolInput["path"].(string)
				call = fmt.Sprintf("Edit(%s)", path)
			} else if msg.ToolName == "Bash" {
				cmd, _ := msg.ToolInput["command"].(string)
				call = fmt.Sprintf("Bash(%s)", cmd)
			} else if msg.ToolName == "SubAgent" {
				task, _ := msg.ToolInput["task"].(string)
				if len(task) > 30 {
					task = task[:30] + "..."
				}
				call = fmt.Sprintf("SubAgent(%s)", task)
			} else if msg.ToolName == "ActivateSkill" {
				name, _ := msg.ToolInput["name"].(string)
				call = fmt.Sprintf("ActivateSkill(%s)", name)
			} else if msg.ToolName == "AskUser" {
				question, _ := msg.ToolInput["question"].(string)
				call = fmt.Sprintf("AskUser(%q)", question)
			} else if msg.ToolName == "SetModel" {
				tier, _ := msg.ToolInput["tier"].(string)
				call = fmt.Sprintf("SetModel(Tier %s)", tier)
			} else {
				call = fmt.Sprintf("%s(%v)", msg.ToolName, msg.ToolInput)
			}

			lines = append(lines, styleToolCall.Render(call))
			if msg.ToolOutput != "" {
				// Read summarises: "Read N lines, M chars" (matches TS)
				if msg.ToolName == "Read" {
					nl := strings.Count(msg.ToolOutput, "\n") + 1
					lines = append(lines, styleDim.Render(fmt.Sprintf("Read %d lines, %d chars", nl, len(msg.ToolOutput))))
				} else if msg.ToolName == "ActivateSkill" {
					lines = append(lines, styleDim.Render("Loaded"))
				} else if msg.ToolName == "Edit" {
					for _, line := range strings.Split(msg.ToolOutput, "\n") {
						if strings.Contains(line, " + ") {
							lines = append(lines, styleGreen.Render(line))
						} else if strings.Contains(line, " - ") {
							lines = append(lines, styleRed.Render(line))
						} else {
							lines = append(lines, styleDim.Render(line))
						}
					}
				} else {
					for _, line := range strings.Split(msg.ToolOutput, "\n") {
						lines = append(lines, styleDim.Render(line))
					}
				}
			}
			lines = append(lines, "")
		case domain.RoleStatus:
			lines = append(lines, styleDim.Render("— "+msg.Content))
			lines = append(lines, "")
		case domain.RoleError:
			lines = append(lines, styleErrorMsg.Render("✕ "+msg.Content))
			lines = append(lines, "")
		}
	}
	result := strings.Join(lines, "\n") + "\n"

	// Multi-agent switch hint (matches TS)
	if len(m.sessions) > 1 {
		result += styleYellow.Render("Ctrl+O: switch agent") + "\n"
	}

	return result
}

// setMode initializes a bubbles/list for a select mode.
func (m *TUIModel) setMode(mode string, title string, items []list.Item) {
	// Create item delegate with simple rendering
	delegate := list.NewDefaultDelegate()
	delegate.Styles.SelectedTitle = delegate.Styles.SelectedTitle.Foreground(lipgloss.Color("6"))
	delegate.Styles.SelectedDesc = delegate.Styles.SelectedDesc.Foreground(lipgloss.Color("6"))

	l := list.New(items, delegate, m.width-4, m.height-8)
	l.SetShowTitle(true)
	l.Title = title
	l.SetShowHelp(true)
	l.SetShowStatusBar(false)
	l.SetFilteringEnabled(false)
	l.Styles.Title = styleHeaderCyan

	m.selectList = l
	m.selectMode = mode
}

func (m *TUIModel) clearMode() {
	m.selectMode = ""
	m.selectList = list.Model{}
}

func (m *TUIModel) handleSelectChoice(val string) {
	switch m.selectMode {
	case "effort-select":
		config.SetEffort(val)
		m.agent.Store().AddStatus(domain.RoleStatus, fmt.Sprintf("Effort set to: %s", val))
		m.clearMode()
	case "session-list":
		m.clearMode()
		if err := m.agent.LoadSession(val); err != nil {
			m.agent.Store().AddStatus(domain.RoleError, fmt.Sprintf("Session not found: %s", val))
			break
		}
		m.session = val
		m.messages = ToDisplayMessages(m.agent.Store().Turns(), m.agent.Store().Statuses(), m.agent.Store().IsStreaming())
		m.tokenCount = m.agent.TokenCount()
		m.viewport.SetContent(m.renderMessages())
		m.viewport.GotoBottom()
		m.agent.Store().AddStatus(domain.RoleStatus, fmt.Sprintf("Loaded session: %s", val))
	case "model-tier":
		m.handleModelTier(val)
	case "model-edit-tier":
		m.handleModelEditTier(val)
	case "model-provider":
		m.handleModelProvider(val)
	case "model-model":
		m.handleModelSelect(val)
	}
}

// ---- Model wizard handlers ----

func (m *TUIModel) handleModelTier(val string) {
	if val == "_edit_" {
		cfg, _ := config.Load()
		tiers := cfg.Tiers
		if tiers == nil {
			tiers = map[string]string{}
		}
		var items []list.Item
		for _, t := range []string{"1", "2", "3"} {
			label := tiers[t]
			if label == "" {
				label = "(unset)"
			}
			items = append(items, listItem{title: t, desc: fmt.Sprintf("Tier %s -> %s", t, label)})
		}
		m.setMode("model-edit-tier", "Edit which tier?", items)
		return
	}
	// Direct tier selection: parse the model specifier and apply
	cfg, _ := config.Load()
	tier := extractTierFromLabel(val)
	if tier == "" {
		return
	}
	spec := ""
	if cfg.Tiers != nil {
		spec = cfg.Tiers[tier]
	}
	if spec == "" {
		return
	}
	applyModelSpec(m, spec)
	m.clearMode()
}

func (m *TUIModel) handleModelEditTier(val string) {
	m.modelWizardEditTier = val
	cfg, _ := config.Load()
	var items []list.Item
	for k, p := range cfg.Providers {
		if p.APIKey != "" {
			items = append(items, listItem{title: k, desc: p.BaseURL})
		}
	}
	if len(items) == 0 {
		m.agent.Store().AddStatus(domain.RoleError, "No configured providers found")
		m.clearMode()
		return
	}
	m.setMode("model-provider", fmt.Sprintf("Provider for Tier %s:", val), items)
}

func (m *TUIModel) handleModelProvider(val string) {
	m.modelWizardProvider = val
	cfg, _ := config.Load()
	provider := cfg.Providers[val]
	var items []list.Item
	for modelName := range provider.Models {
		items = append(items, listItem{title: modelName, desc: ""})
	}
	if len(items) == 0 {
		m.agent.Store().AddStatus(domain.RoleError, fmt.Sprintf("No models configured for %s", val))
		m.clearMode()
		return
	}
	m.setMode("model-model", fmt.Sprintf("Model for Tier %s @%s:", m.modelWizardEditTier, val), items)
}

func (m *TUIModel) handleModelSelect(modelName string) {
	spec := modelName + "@" + m.modelWizardProvider
	config.SetTier(m.modelWizardEditTier, spec)
	applyModelSpec(m, spec)
	m.agent.Store().AddStatus(domain.RoleStatus, fmt.Sprintf("Tier %s -> %s", m.modelWizardEditTier, spec))
	m.clearMode()
}

func extractTierFromLabel(label string) string {
	// Label format: "Tier N -> model@provider"
	if len(label) < 5 || label[:5] != "Tier " {
		return ""
	}
	rest := label[5:]
	for i, c := range rest {
		if c == ' ' {
			return rest[:i]
		}
	}
	return rest
}

func applyModelSpec(m *TUIModel, spec string) {
	cfg, _ := config.Load()
	parts := strings.SplitN(spec, "@", 2)
	modelName := parts[0]
	providerName := ""
	if len(parts) > 1 {
		providerName = parts[1]
	}
	if providerName == "" {
		for k := range cfg.Providers {
			providerName = k
			break
		}
	}
	provider := cfg.Providers[providerName]
	contextLen := 0
	if info, ok := provider.Models[modelName]; ok {
		contextLen = info.ContextLength
	}
	m.agent.SetModel(spec, provider.APIKey, provider.BaseURL, contextLen)
	config.SetModel(spec)
	m.modelName = modelName
}

// ---- Helpers ----

// listItem implements list.DefaultItem for use with bubbles/list selections.
type listItem struct {
	title string
	desc  string
}

func (i listItem) Title() string       { return i.title }
func (i listItem) Description() string { return i.desc }
func (i listItem) FilterValue() string { return i.title }

func truncate(s string, maxLen int) string {
	lines := strings.Split(s, "\n")
	if len(lines) > 1 {
		s = lines[0] + "..."
	}
	if len(s) > maxLen {
		return s[:maxLen] + "..."
	}
	return s
}

// ---- TUI entry point ----

// RunTUI starts the interactive Bubble Tea terminal UI.
func RunTUI(ag *agent.Agent, registry *agent.AgentRegistry, cmdReg *CommandRegistry, promptFiles []string) error {
	m := NewTUIModel(ag, registry, cmdReg, promptFiles)
	p := tea.NewProgram(m, tea.WithAltScreen())
	m.program = p
	_, err := p.Run()
	return err
}

// ToDisplayMessages converts current state to render-ready DisplayMessages.
func ToDisplayMessages(turns []domain.MessageParam, statuses []agent.StatusMessage, streaming bool) []domain.DisplayMessage {
	var out []domain.DisplayMessage
	results := make(map[string]string)

	for ti, t := range turns {
		domain.ExtractResults(t.Content, results)

		switch t.Role {
		case "user":
			content := t.Display
			if content == "" {
				if s, ok := t.Content.(string); ok {
					content = s
				}
			}
			if content != "" {
				out = append(out, domain.DisplayMessage{Role: domain.RoleUser, Content: content})
			}
		case "assistant":
			var blocks []domain.ContentBlock
			switch c := t.Content.(type) {
			case []domain.ContentBlock:
				blocks = c
			case []any:
				for _, b := range c {
					if m, ok := b.(map[string]any); ok {
						blocks = append(blocks, domain.ContentBlockFromMap(m))
					}
				}
			}

			for bi, b := range blocks {
				isLast := ti == len(turns)-1 && bi == len(blocks)-1
				isStr := streaming && isLast

				switch b.Type {
				case "text":
					out = append(out, domain.DisplayMessage{Role: domain.RoleText, Content: b.Text, IsStreaming: isStr})
				case "thinking":
					out = append(out, domain.DisplayMessage{Role: domain.RoleThinking, Content: b.Thinking, IsStreaming: isStr})
				case "tool_use":
					msg := domain.DisplayMessage{Role: domain.RoleTool, ToolName: b.Name, SlotID: b.ID}
					if input, ok := b.Input.(map[string]any); ok {
						msg.ToolInput = input
					}
					// Check if we have a result for this tool yet
					if res, ok := results[b.ID]; ok {
						msg.ToolOutput = res
					}
					out = append(out, msg)
				}
			}
		}

		// Inject statuses that happened after this turn
		for _, s := range statuses {
			if s.TurnIndex == ti+1 {
				out = append(out, domain.DisplayMessage{
					Role:      s.Role,
					Content:   s.Content,
					Timestamp: &s.Timestamp,
				})
			}
		}
	}
	return out
}
