package internal

import "time"

// ChangeCallback is called whenever the store mutates.
type ChangeCallback func()

// Store is the central message store — both LLM-facing turns and UI statuses.
type Store struct {
	turns     []MessageParam
	statuses  []StatusMessage
	streaming bool
	onChange  ChangeCallback
}

// NewStore creates a new message store.
func NewStore() *Store { return &Store{} }

// OnChange registers a callback for store mutations (single listener).
func (s *Store) OnChange(cb ChangeCallback) { s.onChange = cb }

func (s *Store) notify() {
	if s.onChange != nil {
		s.onChange()
	}
}

// SetStreaming updates streaming mode and notifies listeners.
func (s *Store) SetStreaming(v bool) {
	if s.streaming != v {
		s.streaming = v
		s.notify()
	}
}

// IsStreaming returns whether the store is in streaming mode.
func (s *Store) IsStreaming() bool { return s.streaming }

// Turns returns all LLM-facing turns.
func (s *Store) Turns() []MessageParam { return s.turns }

// SetTurns replaces all turns (for session resume).
func (s *Store) SetTurns(turns []MessageParam) { s.turns = turns; s.notify() }

// ToLLMMessages returns API-format messages, stripping display-only metadata.
func (s *Store) ToLLMMessages() []MessageParam {
	result := make([]MessageParam, len(s.turns))
	for i, t := range s.turns {
		result[i] = MessageParam{Role: t.Role, Content: t.Content}
	}
	return result
}

// AddUserMessage appends a user turn with optional display override.
func (s *Store) AddUserMessage(content, displayContent string) {
	msg := MessageParam{Role: "user", Content: content}
	if displayContent != "" && displayContent != content {
		msg.Display = displayContent
	}
	s.turns = append(s.turns, msg)
	s.notify()
}

// StartAssistantTurn begins a new empty assistant turn.
func (s *Store) StartAssistantTurn() {
	s.turns = append(s.turns, MessageParam{Role: "assistant", Content: []ContentBlock{}})
	s.notify()
}

// AppendToLastAssistantTurn adds a block to the last assistant turn.
func (s *Store) AppendToLastAssistantTurn(block ContentBlock) {
	last := s.lastAssistantTurn()
	if last < 0 {
		s.StartAssistantTurn()
		last = len(s.turns) - 1
	}
	blocks := s.turns[last].Content.([]ContentBlock)
	s.turns[last].Content = append(blocks, block)
	s.notify()
}

// LastBlock returns the final block in the last assistant turn.
func (s *Store) LastBlock() *ContentBlock {
	last := s.lastAssistantTurn()
	if last < 0 {
		return nil
	}
	blocks := s.turns[last].Content.([]ContentBlock)
	if len(blocks) == 0 {
		return nil
	}
	return &blocks[len(blocks)-1]
}

// UpdateLastBlock mutates the final block's text or thinking fields.
func (s *Store) UpdateLastBlock(text, thinking string) {
	last := s.lastAssistantTurn()
	if last < 0 {
		return
	}
	blocks := s.turns[last].Content.([]ContentBlock)
	if len(blocks) == 0 {
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
	s.notify()
}

func (s *Store) lastAssistantTurn() int {
	for i := len(s.turns) - 1; i >= 0; i-- {
		if s.turns[i].Role == "assistant" {
			if _, ok := s.turns[i].Content.([]ContentBlock); ok {
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
	blocks := make([]ContentBlock, len(results))
	for i, r := range results {
		blocks[i] = ContentBlock{
			Type:      "tool_result",
			ToolUseID: r.ToolUseID,
			Content:   r.Content,
		}
	}
	s.turns = append(s.turns, MessageParam{Role: "user", Content: blocks})
	s.notify()
}

// AddStatus appends a UI status or error message.
func (s *Store) AddStatus(role DisplayRole, content string) {
	s.statuses = append(s.statuses, StatusMessage{
		Role:      role,
		Content:   content,
		TurnIndex: len(s.turns),
		Timestamp: time.Now(),
	})
	s.notify()
}

// ToDisplayMessages converts current state to render-ready DisplayMessages.
func (s *Store) ToDisplayMessages() []DisplayMessage {
	return ToDisplayMessages(s.turns, s.statuses, s.streaming)
}

// Clear resets all state.
func (s *Store) Clear() {
	s.turns = nil
	s.statuses = nil
	s.notify()
}

// Replace sets turns and clears statuses (for compression).
func (s *Store) Replace(turns []MessageParam) {
	s.turns = turns
	s.statuses = nil
	s.notify()
}
