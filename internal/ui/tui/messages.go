package tui

import (
	"minicode/internal/agent"
	"minicode/internal/domain"
)

type displayChangeMsg struct{}

type tokenUpdateMsg struct {
	total int
}

type agentDoneMsg struct {
	err error
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
