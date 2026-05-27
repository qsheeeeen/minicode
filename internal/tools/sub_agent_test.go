package tools

import (
	"context"
	"strings"
	"testing"

	"minicode/internal/domain"
)

type mockAgentFactory struct {
	created bool
	turns   []domain.MessageParam
	runErr  error
}

func (m *mockAgentFactory) Create(cfg domain.AgentConfig) any {
	m.created = true
	return "mock-agent"
}

func (m *mockAgentFactory) Run(ctx context.Context, ag any, task string) error {
	return m.runErr
}

func (m *mockAgentFactory) GetTurns(ag any) []domain.MessageParam {
	return m.turns
}

func TestSubAgentTool_MissingTask(t *testing.T) {
	st := NewSubAgentTool(domain.AgentConfig{})
	result, _ := st.Execute(context.Background(), map[string]any{}, ToolContext{})
	if !strings.Contains(result.Output, "task is required") {
		t.Errorf("expected task error, got %q", result.Output)
	}
}

func TestSubAgentTool_NoAgentFactory(t *testing.T) {
	st := NewSubAgentTool(domain.AgentConfig{})
	result, _ := st.Execute(context.Background(), map[string]any{
		"task": "do something",
	}, ToolContext{})
	if !strings.Contains(result.Output, "No agent factory") {
		t.Errorf("expected factory error, got %q", result.Output)
	}
}

func TestSubAgentTool_Success(t *testing.T) {
	factory := &mockAgentFactory{
		turns: []domain.MessageParam{
			{Role: "assistant", Content: []domain.ContentBlock{
				{Type: "text", Text: "Task completed successfully"},
			}},
		},
	}
	st := NewSubAgentTool(domain.AgentConfig{})
	result, _ := st.Execute(context.Background(), map[string]any{
		"task": "do something",
	}, ToolContext{
		AgentFactory: factory,
	})
	if !factory.created {
		t.Error("expected agent to be created")
	}
	if !strings.Contains(result.Output, "Task completed successfully") {
		t.Errorf("expected success message, got %q", result.Output)
	}
}

func TestSubAgentTool_RunError(t *testing.T) {
	factory := &mockAgentFactory{
		runErr: context.Canceled,
	}
	st := NewSubAgentTool(domain.AgentConfig{})
	result, _ := st.Execute(context.Background(), map[string]any{
		"task": "do something",
	}, ToolContext{
		AgentFactory: factory,
	})
	if !strings.Contains(result.Output, "Sub-agent failed") {
		t.Errorf("expected failure message, got %q", result.Output)
	}
}
