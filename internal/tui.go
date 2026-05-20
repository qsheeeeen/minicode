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
	styleUser     = lipgloss.NewStyle().Foreground(lipgloss.Color("6")).Bold(true)  // cyan
	styleThinking = lipgloss.NewStyle().Foreground(lipgloss.Color("8")).Italic(true) // grey
	styleTool     = lipgloss.NewStyle().Foreground(lipgloss.Color("3"))              // yellow
	styleError    = lipgloss.NewStyle().Foreground(lipgloss.Color("1"))              // red
	styleStatus   = lipgloss.NewStyle().Foreground(lipgloss.Color("8"))              // grey
	styleAssistant = lipgloss.NewStyle()                                              // default
	styleHeader   = lipgloss.NewStyle().Background(lipgloss.Color("4")).Foreground(lipgloss.Color("15")).Padding(0, 1)
	styleStatusBar = lipgloss.NewStyle().Background(lipgloss.Color("8")).Foreground(lipgloss.Color("15")).Padding(0, 1)
)

// ---- Messages ----

type agentStreamMsg struct {
	messages []DisplayMessage
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
	agent         *Agent
	agentRegistry *AgentRegistry
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
func NewTUIModel(ag *Agent, registry *AgentRegistry) *TUIModel {
	ta := textarea.New()
	ta.Placeholder = "Type your message... (Ctrl+O: switch agent, Ctrl+C: quit)"
	ta.ShowLineNumbers = false
	ta.SetHeight(3)

	vp := viewport.New(80, 20)

	m := &TUIModel{
		agent:         ag,
		agentRegistry: registry,
		viewport:      vp,
		input:         ta,
		modelName:     ag.Model(),
		session:       ag.SessionName(),
		messages:      ag.Store().ToDisplayMessages(),
	}

	ag.OnDisplayChange(func() {
		m.messages = ag.Store().ToDisplayMessages()
		m.streaming = ag.Store().IsStreaming()
		m.tokenCount = ag.TokenCount()
	})

	ag.OnTokenUpdate(func(total int) {
		m.tokenCount = total
	})

	return m
}

// Init is the Bubble Tea Init function.
func (m *TUIModel) Init() tea.Cmd {
	return tea.Batch(textarea.Blink, m.waitForAgent)
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

		case tea.KeyEnter:
			input := strings.TrimSpace(m.input.Value())
			if input == "" {
				return m, nil
			}
			m.input.Reset()
			// Check for commands
			if len(input) > 0 && input[0] == '/' {
				// For now, just send as-is (commands handled in agent resolver)
			}
			go func() {
				_, err := m.agent.Run(context.Background(), input)
				if err != nil && err.Error() != "context canceled" {
					// handled via agentDoneMsg
				}
			}()
			return m, m.waitForAgent

		case tea.KeyCtrlO:
			// Multi-agent switching: cycle through registered agents
			if m.agentRegistry != nil && len(m.agentRegistry.List()) > 1 {
				next := m.agentRegistry.NextActive()
				if next != nil {
					m.agent = next
					m.messages = next.Store().ToDisplayMessages()
					m.modelName = next.Model()
					m.session = next.SessionName()
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

	case agentStreamMsg:
		m.messages = msg.messages
		m.viewport.SetContent(m.renderMessages())
		m.viewport.GotoBottom()
		return m, m.waitForAgent

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
	title := fmt.Sprintf(" minicode [Go] — %s | session: %s ", m.modelName, m.session)
	if m.streaming {
		title += "⏳ "
	}
	return styleHeader.Render(title)
}

func (m *TUIModel) renderInput() string {
	if m.permPending {
		return styleTool.Render(fmt.Sprintf("[Permission] %s [y=yes / n=no / a=yes to all]", m.permText))
	}
	if m.streaming {
		return styleThinking.Render("(Waiting for response...)")
	}
	return m.input.View()
}

func (m *TUIModel) renderStatusBar() string {
	tokens := fmt.Sprintf("%d tok", m.tokenCount)
	mode := fmt.Sprintf("stream=%v", m.streaming)
	left := tokens
	right := mode
	gap := m.width - len(left) - len(right) - 4
	if gap < 0 {
		gap = 0
	}
	return styleStatusBar.Render(left + strings.Repeat(" ", gap) + right)
}

func (m *TUIModel) renderMessages() string {
	if len(m.messages) == 0 {
		return "No messages yet. Type something to start.\n"
	}

	var lines []string
	for _, msg := range m.messages {
		switch msg.Role {
		case RoleUser:
			lines = append(lines, styleUser.Render("You:")+" "+msg.Content)
		case RoleText:
			prefix := ""
			if msg.IsStreaming {
				prefix = "▌"
			}
			lines = append(lines, prefix+styleAssistant.Render(msg.Content))
		case RoleThinking:
			prefix := ""
			if msg.IsStreaming {
				prefix = "... "
			}
			lines = append(lines, styleThinking.Render(prefix+"[thinking] "+truncate(msg.Content, 200)))
		case RoleTool:
			lines = append(lines, styleTool.Render(fmt.Sprintf("[%s]", msg.ToolName)))
			if msg.ToolOutput != "" {
				for _, line := range strings.Split(msg.ToolOutput, "\n") {
					lines = append(lines, "  "+line)
				}
			}
		case RoleStatus:
			lines = append(lines, styleStatus.Render("· "+msg.Content))
		case RoleError:
			lines = append(lines, styleError.Render("[!] "+msg.Content))
		}
	}
	return strings.Join(lines, "\n") + "\n"
}

func (m *TUIModel) waitForAgent() tea.Msg {
	// Poll for new messages while agent is running
	msgs := m.agent.Store().ToDisplayMessages()
	return agentStreamMsg{messages: msgs}
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
func RunTUI(ag *Agent, registry *AgentRegistry) error {
	m := NewTUIModel(ag, registry)
	p := tea.NewProgram(m, tea.WithAltScreen())
	_, err := p.Run()
	return err
}
