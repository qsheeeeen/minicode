package agent

import (
	"log/slog"
	"sync"
	"time"

	"minicode/internal/domain"
	"minicode/internal/log"
)

// ChangeCallback is called whenever the store mutates.
type ChangeCallback func()

// Store is the central message store — both LLM-facing turns and UI statuses.
type Store struct {
	mu        sync.RWMutex
	turns     []domain.MessageParam
	statuses  []StatusMessage
	streaming bool
	onChange  ChangeCallback
	logger    *slog.Logger
}

// StatusMessage represents a UI-only update.
type StatusMessage struct {
	Role      domain.DisplayRole
	Content   string
	TurnIndex int
	Timestamp time.Time
}

// NewStore creates a new message store.
func NewStore() *Store { return &Store{logger: log.Default} }

// OnChange registers a callback for store mutations (single listener).
func (s *Store) OnChange(cb ChangeCallback) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.onChange = cb
}

// SetLogger sets the structured logger for store operations.
func (s *Store) SetLogger(l *slog.Logger) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.logger = l
}

func (s *Store) log(msg string, attrs ...any) {
	s.logger.Info(msg, attrs...)
}

func (s *Store) notify() {
	s.mu.RLock()
	cb := s.onChange
	s.mu.RUnlock()
	if cb != nil {
		cb()
	}
}

// SetStreaming updates streaming mode and notifies listeners.
func (s *Store) SetStreaming(v bool) {
	s.mu.Lock()
	changed := s.streaming != v
	if changed {
		s.streaming = v
	}
	s.mu.Unlock()
	if changed {
		s.log("streaming state changed", "streaming", v)
		s.notify()
	}
}

// IsStreaming returns whether the store is in streaming mode.
func (s *Store) IsStreaming() bool {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.streaming
}

// Turns returns all LLM-facing turns.
func (s *Store) Turns() []domain.MessageParam {
	s.mu.RLock()
	defer s.mu.RUnlock()
	// Return a copy to avoid data races
	cpy := make([]domain.MessageParam, len(s.turns))
	copy(cpy, s.turns)
	return cpy
}

// SetTurns replaces all turns (for session resume).
func (s *Store) SetTurns(turns []domain.MessageParam) {
	s.mu.Lock()
	s.turns = turns
	s.mu.Unlock()
	s.log("turns replaced", "count", len(turns))
	s.notify()
}

// ToLLMMessages returns API-format messages, stripping display-only metadata.
func (s *Store) ToLLMMessages() []domain.MessageParam {
	s.mu.RLock()
	defer s.mu.RUnlock()
	var result []domain.MessageParam
	for _, t := range s.turns {
		// Skip empty assistant turns at the end (can happen if we just started one)
		if t.Role == "assistant" {
			if blocks, ok := t.Content.([]domain.ContentBlock); ok && len(blocks) == 0 {
				continue
			}
		}
		result = append(result, domain.MessageParam{Role: t.Role, Content: t.Content})
	}
	return result
}

// AddUserMessage appends a user turn with optional display override.
func (s *Store) AddUserMessage(content, displayContent string) {
	s.mu.Lock()
	msg := domain.MessageParam{Role: "user", Content: content}
	if displayContent != "" && displayContent != content {
		msg.Display = displayContent
	}
	s.turns = append(s.turns, msg)
	s.mu.Unlock()
	s.log("user message added", "content_length", len(content), "has_display", displayContent != "" && displayContent != content)
	s.notify()
}

// StartAssistantTurn begins a new empty assistant turn.
func (s *Store) StartAssistantTurn() {
	s.mu.Lock()
	s.turns = append(s.turns, domain.MessageParam{Role: "assistant", Content: []domain.ContentBlock{}})
	s.mu.Unlock()
	s.log("assistant turn started")
	s.notify()
}

// AppendToLastAssistantTurn adds a block to the last assistant turn.
func (s *Store) AppendToLastAssistantTurn(block domain.ContentBlock) {
	s.mu.Lock()
	last := s.lastAssistantTurnLocked()
	if last < 0 {
		s.turns = append(s.turns, domain.MessageParam{Role: "assistant", Content: []domain.ContentBlock{}})
		last = len(s.turns) - 1
	}
	blocks := s.turns[last].Content.([]domain.ContentBlock)
	s.turns[last].Content = append(blocks, block)
	s.mu.Unlock()
	s.log("block appended", "type", block.Type, "turn", last)
	s.notify()
}

// LastBlock returns the final block in the last assistant turn.
func (s *Store) LastBlock() *domain.ContentBlock {
	s.mu.RLock()
	defer s.mu.RUnlock()
	last := s.lastAssistantTurnLocked()
	if last < 0 {
		return nil
	}
	blocks := s.turns[last].Content.([]domain.ContentBlock)
	if len(blocks) == 0 {
		return nil
	}
	b := blocks[len(blocks)-1] // return copy
	return &b
}

// UpdateLastBlock mutates the final block's text or thinking fields.
func (s *Store) UpdateLastBlock(text, thinking string) {
	s.mu.Lock()
	last := s.lastAssistantTurnLocked()
	if last < 0 {
		s.mu.Unlock()
		return
	}
	blocks := s.turns[last].Content.([]domain.ContentBlock)
	if len(blocks) == 0 {
		s.mu.Unlock()
		return
	}
	b := &blocks[len(blocks)-1]
	if text != "" {
		b.Text = text
	}
	if thinking != "" {
		b.Thinking = thinking
	}
	s.turns[last].Content = blocks
	s.mu.Unlock()
	s.notify()
}

func (s *Store) lastAssistantTurnLocked() int {
	for i := len(s.turns) - 1; i >= 0; i-- {
		if s.turns[i].Role == "assistant" {
			if _, ok := s.turns[i].Content.([]domain.ContentBlock); ok {
				return i
			}
		}
	}
	return -1
}

// toolResultItem represents a single tool execution result.
type toolResultItem struct {
	ToolUseID string
	Content   string
}

// AddToolResults appends a user turn containing tool_result blocks.
func (s *Store) AddToolResults(results []toolResultItem) {
	if len(results) == 0 {
		return
	}
	s.mu.Lock()
	blocks := make([]domain.ContentBlock, len(results))
	for i, r := range results {
		blocks[i] = domain.ContentBlock{
			Type:      "tool_result",
			ToolUseID: r.ToolUseID,
			Content:   r.Content,
		}
	}
	s.turns = append(s.turns, domain.MessageParam{Role: "user", Content: blocks})
	s.mu.Unlock()
	s.log("tool results added", "count", len(results))
	s.notify()
}

// AddStatus appends a UI status or error message.
func (s *Store) AddStatus(role domain.DisplayRole, content string) {
	s.mu.Lock()
	s.statuses = append(s.statuses, StatusMessage{
		Role:      role,
		Content:   content,
		TurnIndex: len(s.turns),
		Timestamp: time.Now(),
	})
	s.mu.Unlock()
	s.log("status added", "role", role, "content", content)
	s.notify()
}

// Statuses returns all status messages.
func (s *Store) Statuses() []StatusMessage {
	s.mu.RLock()
	defer s.mu.RUnlock()
	cpy := make([]StatusMessage, len(s.statuses))
	copy(cpy, s.statuses)
	return cpy
}

// Clear resets all state.
func (s *Store) Clear() {
	s.mu.Lock()
	s.turns = nil
	s.statuses = nil
	s.mu.Unlock()
	s.log("store cleared")
	s.notify()
}

// Replace sets turns and clears statuses (for compression).
func (s *Store) Replace(turns []domain.MessageParam) {
	s.mu.Lock()
	s.turns = turns
	s.statuses = nil
	s.mu.Unlock()
	s.log("turns replaced (compression)", "count", len(turns))
	s.notify()
}

// Pop removes the last turn from the store.
func (s *Store) Pop() {
	s.mu.Lock()
	if len(s.turns) > 0 {
		s.turns = s.turns[:len(s.turns)-1]
	}
	s.mu.Unlock()
	s.log("last turn popped")
	s.notify()
}
