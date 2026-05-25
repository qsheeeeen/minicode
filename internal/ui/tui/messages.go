package tui

import (
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

type askPromptMsg struct {
	question string
	options  []domain.AskOption
	multi    bool
	resolve  chan string
}
