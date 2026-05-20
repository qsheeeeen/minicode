package internal

import "sync"

// AgentRegistry manages multiple agents and supports cycling between them.
type AgentRegistry struct {
	mu       sync.Mutex
	agents   []*Agent
	activeID int
}

// NewAgentRegistry creates an agent registry with the initial agent.
func NewAgentRegistry(primary *Agent) *AgentRegistry {
	return &AgentRegistry{
		agents:   []*Agent{primary},
		activeID: 0,
	}
}

// Add registers a new agent.
func (r *AgentRegistry) Add(ag *Agent) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.agents = append(r.agents, ag)
}

// List returns all registered agents.
func (r *AgentRegistry) List() []*Agent {
	r.mu.Lock()
	defer r.mu.Unlock()
	out := make([]*Agent, len(r.agents))
	copy(out, r.agents)
	return out
}

// Active returns the currently active agent.
func (r *AgentRegistry) Active() *Agent {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.activeID >= len(r.agents) {
		r.activeID = 0
	}
	return r.agents[r.activeID]
}

// NextActive cycles to the next agent and returns it.
func (r *AgentRegistry) NextActive() *Agent {
	r.mu.Lock()
	defer r.mu.Unlock()
	if len(r.agents) == 0 {
		return nil
	}
	r.activeID = (r.activeID + 1) % len(r.agents)
	return r.agents[r.activeID]
}
