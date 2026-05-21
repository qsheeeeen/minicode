package internal

import (
	"fmt"
	"sync"
)

// AgentSessionType defines the role of an agent.
type AgentSessionType string

const (
	AgentMain AgentSessionType = "main"
	AgentSub  AgentSessionType = "sub"
)

// AgentStatus defines the execution state of an agent.
type AgentStatus string

const (
	StatusIdle      AgentStatus = "idle"
	StatusRunning   AgentStatus = "running"
	StatusCompleted AgentStatus = "completed"
	StatusError     AgentStatus = "error"
)

// AgentSession tracks an agent's lifecycle and metadata.
type AgentSession struct {
	ID       string
	Type     AgentSessionType
	Agent    *Agent
	Status   AgentStatus
	Task     string
	ParentID string
	Summary  string
}

// AgentRegistry manages multiple agent sessions.
type AgentRegistry struct {
	mu             sync.Mutex
	sessions       map[string]*AgentSession
	order          []string
	activeID       string
	updateCallback func(sessions []AgentSession)
}

// NewAgentRegistry creates an agent registry with the initial agent.
func NewAgentRegistry(primary *Agent) *AgentRegistry {
	s := &AgentSession{
		ID:     "1",
		Type:   AgentMain,
		Agent:  primary,
		Status: StatusIdle,
	}
	return &AgentRegistry{
		sessions: map[string]*AgentSession{"1": s},
		order:    []string{"1"},
		activeID: "1",
	}
}

// Register adds a new session and notifies.
func (r *AgentRegistry) Register(s *AgentSession) {
	r.mu.Lock()
	r.sessions[s.ID] = s
	r.order = append(r.order, s.ID)
	r.mu.Unlock()
	r.notify()
}

// Get returns a session by ID.
func (r *AgentRegistry) Get(id string) (*AgentSession, bool) {
	r.mu.Lock()
	defer r.mu.Unlock()
	s, ok := r.sessions[id]
	return s, ok
}

// List returns all registered sessions.
func (r *AgentRegistry) List() []AgentSession {
	r.mu.Lock()
	defer r.mu.Unlock()
	out := make([]AgentSession, 0, len(r.order))
	for _, id := range r.order {
		if s, ok := r.sessions[id]; ok {
			out = append(out, *s)
		}
	}
	return out
}

// Active returns the currently active agent.
func (r *AgentRegistry) Active() *Agent {
	r.mu.Lock()
	defer r.mu.Unlock()
	if s, ok := r.sessions[r.activeID]; ok {
		return s.Agent
	}
	return nil
}

// NextActive cycles to the next agent and returns it.
func (r *AgentRegistry) NextActive() *Agent {
	r.mu.Lock()
	defer r.mu.Unlock()
	if len(r.order) <= 1 {
		return nil
	}
	idx := -1
	for i, id := range r.order {
		if id == r.activeID {
			idx = i
			break
		}
	}
	nextIdx := (idx + 1) % len(r.order)
	r.activeID = r.order[nextIdx]
	return r.sessions[r.activeID].Agent
}

// AllocateSubID returns a unique ID for a sub-agent.
func (r *AgentRegistry) AllocateSubID() string {
	r.mu.Lock()
	defer r.mu.Unlock()
	for i := 2; i <= 9; i++ {
		id := fmt.Sprintf("%d", i)
		if _, ok := r.sessions[id]; !ok {
			return id
		}
	}
	return fmt.Sprintf("%d", len(r.sessions)+1)
}

// SetUpdateCallback sets a function called whenever sessions change.
func (r *AgentRegistry) OnUpdate(cb func(sessions []AgentSession)) {
	r.mu.Lock()
	r.updateCallback = cb
	r.mu.Unlock()
}

func (r *AgentRegistry) notify() {
	r.mu.Lock()
	cb := r.updateCallback
	r.mu.Unlock()
	if cb != nil {
		cb(r.List())
	}
}

// UpdateStatus sets the status of a session.
func (r *AgentRegistry) UpdateStatus(id string, status AgentStatus, summary string) {
	r.mu.Lock()
	if s, ok := r.sessions[id]; ok {
		s.Status = status
		if summary != "" {
			s.Summary = summary
		}
	}
	r.mu.Unlock()
	r.notify()
}
