package internal

import (
	"context"
	"fmt"
	"strings"

	"github.com/charmbracelet/bubbles/textarea"
	"github.com/charmbracelet/bubbles/viewport"
	tea "github.com/charmbracelet/bubbletea"
	"github.com/charmbracelet/lipgloss"
)

// ---- Styles ----

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

type permPromptMsg struct {
	displayText string
}

type permResolveMsg struct {
	answer string
}

// ---- Model ----

// TUIModel is the top-level Bubble Tea model.
type TUIModel struct {
	program       *tea.Program
	agent         *Agent
	agentRegistry *AgentRegistry
	cmdReg        *CommandRegistry
	viewport      viewport.Model
	input         textarea.Model

	messages   []DisplayMessage
	streaming  bool
	tokenCount int
	modelName  string
	session    string

	// Permission prompt state
	permPending bool
	permText    string
	permOptions []string

	width  int
	height int
	ready  bool
	err    error
}

// NewTUIModel creates the TUI model.
func NewTUIModel(ag *Agent, registry *AgentRegistry, cmdReg *CommandRegistry) *TUIModel {
	ta := textarea.New()
	ta.Placeholder = "Type your message... (Ctrl+O: switch agent, Ctrl+C: quit)"
	ta.ShowLineNumbers = false
	ta.SetHeight(3)
	ta.Focus()

	vp := viewport.New(80, 20)

	m := &TUIModel{
		agent:         ag,
		agentRegistry: registry,
		cmdReg:        cmdReg,
		viewport:      vp,
		input:         ta,
		modelName:     ag.Model(),
		session:       ag.SessionName(),
		messages:      ag.Store().ToDisplayMessages(),
		streaming:     ag.Store().IsStreaming(),
		tokenCount:    ag.TokenCount(),
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

	return m
}

// Init is the Bubble Tea Init function.
func (m *TUIModel) Init() tea.Cmd {
	return textarea.Blink
}

// Update is the Bubble Tea Update function.
func (m *TUIModel) Update(msg tea.Msg) (tea.Model, tea.Cmd) {
	var cmds []tea.Cmd

	switch msg := msg.(type) {
	case tea.KeyMsg:
		if m.permPending {
			return m.handlePermKey(msg)
		}

		switch msg.Type {
		case tea.KeyCtrlC:
			m.agent.Abort()
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
			if m.agentRegistry != nil && len(m.agentRegistry.List()) > 1 {
				next := m.agentRegistry.NextActive()
				if next != nil {
					m.agent = next
					m.messages = next.Store().ToDisplayMessages()
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
			}
		}

	case displayChangeMsg:
		m.messages = m.agent.Store().ToDisplayMessages()
		m.streaming = m.agent.Store().IsStreaming()
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
		m.messages = m.agent.Store().ToDisplayMessages()
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
		m.ready = true
	}

	var cmd tea.Cmd
	m.viewport, cmd = m.viewport.Update(msg)
	cmds = append(cmds, cmd)

	return m, tea.Batch(cmds...)
}

func (m *TUIModel) handlePermKey(msg tea.KeyMsg) (tea.Model, tea.Cmd) {
	switch msg.String() {
	case "y":
		m.permPending = false
		return m, func() tea.Msg { return permResolveMsg{answer: "yes"} }
	case "n", "esc":
		m.permPending = false
		return m, func() tea.Msg { return permResolveMsg{answer: "no"} }
	case "a":
		m.permPending = false
		return m, func() tea.Msg { return permResolveMsg{answer: "yolo"} }
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
	if m.agentRegistry != nil && len(m.agentRegistry.List()) > 1 {
		indicator := m.activeAgentId()
		if indicator == "1" {
			indicator = "M"
		}
		agentStr = "\n" + styleHeaderCyan.Render(fmt.Sprintf("[%s]", indicator))
	}

	line1 := styleHeaderCyan.Render("Mini Code") + styleDim.Render(" v0.1.0 (Go)")
	return line1 + agentStr + "\n"
}

func (m *TUIModel) activeAgentId() string {
	// For now just return M or active ID if available
	return "M"
}

func (m *TUIModel) renderInput() string {
	if m.permPending {
		return styleToolCall.Render(fmt.Sprintf("[Permission] %s [y=yes / n=no / a=yes to all]", m.permText))
	}

	prefix := styleInputArrow.Render("> ")
	if m.streaming {
		prefix = styleDim.Render("… ")
	}

	content := prefix + m.input.View()
	return styleInputBorder.Width(m.width - 2).Render(content)
}

func (m *TUIModel) renderStatusBar() string {
	line1 := styleGreen.Render("Anthropic") + styleDim.Render(":") + m.modelName + styleDim.Render(" | "+m.session)
	if m.streaming {
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

	barWidth := 20
	filled := int((pct / 100) * float64(barWidth))
	if filled > barWidth {
		filled = barWidth
	}
	bar := strings.Repeat("█", filled) + strings.Repeat("░", barWidth-filled)

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
		bar +
		styleDim.Render(fmt.Sprintf(" %d%% │ ", int(pct))) +
		modeColor.Render(permMode) +
		styleDim.Render(" (Shift+Tab)")

	return line1 + "\n" + line2
}

func (m *TUIModel) renderMessages() string {
	if len(m.messages) == 0 {
		return "No messages yet. Type something to start.\n"
	}

	var lines []string
	for _, msg := range m.messages {
		switch msg.Role {
		case RoleUser:
			lines = append(lines, styleUserBg.Render(strings.TrimSpace(msg.Content)))
			lines = append(lines, "")
		case RoleText:
			lines = append(lines, strings.TrimSpace(msg.Content))
			lines = append(lines, "")
		case RoleThinking:
			lines = append(lines, styleThinking.Render("Thinking"))
			lines = append(lines, styleDim.Render(strings.TrimSpace(msg.Content)))
			lines = append(lines, "")
		case RoleTool:
			var call string
			if msg.ToolName == "Read" {
				path, _ := msg.ToolInput["path"].(string)
				call = fmt.Sprintf("Read(%s)", path)
			} else if msg.ToolName == "Write" || msg.ToolName == "Edit" {
				path, _ := msg.ToolInput["path"].(string)
				call = fmt.Sprintf("%s(%s)", msg.ToolName, path)
			} else if msg.ToolName == "Bash" {
				cmd, _ := msg.ToolInput["command"].(string)
				call = fmt.Sprintf("Bash(%s)", cmd)
			} else if msg.ToolName == "SubAgent" {
				task, _ := msg.ToolInput["task"].(string)
				if len(task) > 30 {
					task = task[:30] + "..."
				}
				call = fmt.Sprintf("SubAgent(%s)", task)
			} else {
				call = fmt.Sprintf("%s(%v)", msg.ToolName, msg.ToolInput)
			}

			lines = append(lines, styleToolCall.Render(call))
			if msg.ToolOutput != "" {
				if msg.ToolName == "Edit" {
					for _, line := range strings.Split(msg.ToolOutput, "\n") {
						trimmed := strings.TrimSpace(line)
						if len(trimmed) > 0 && trimmed[0] == '+' {
							lines = append(lines, styleGreen.Render(line))
						} else if len(trimmed) > 0 && trimmed[0] == '-' {
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
		case RoleStatus:
			lines = append(lines, styleDim.Render("— "+msg.Content))
			lines = append(lines, "")
		case RoleError:
			lines = append(lines, styleErrorMsg.Render("✕ "+msg.Content))
			lines = append(lines, "")
		}
	}
	return strings.Join(lines, "\n") + "\n"
}

// ---- Helpers ----

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
func RunTUI(ag *Agent, registry *AgentRegistry, cmdReg *CommandRegistry) error {
	m := NewTUIModel(ag, registry, cmdReg)
	p := tea.NewProgram(m, tea.WithAltScreen())
	m.program = p
	_, err := p.Run()
	return err
}
