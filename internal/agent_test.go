package internal

import (
	"context"
	"testing"
)

func TestNewAgent_DefaultValues(t *testing.T) {
	ag := NewAgent(AgentConfig{APIKey: "test", Model: "m1", ContextLength: 100000})
	if ag == nil {
		t.Fatal("expected non-nil agent")
	}
	if ag.Model() != "m1" {
		t.Errorf("expected m1, got %s", ag.Model())
	}
	if ag.TokenCount() != 0 {
		t.Errorf("expected 0 tokens, got %d", ag.TokenCount())
	}
	if ag.Store() == nil {
		t.Error("store should not be nil")
	}
	if ag.SystemPrompt() == "" {
		t.Error("system prompt should not be empty")
	}
}

func TestNewAgent_ContextLengthDefault(t *testing.T) {
	ag := NewAgent(AgentConfig{APIKey: "test", Model: "m1"})
	if ag.config.ContextLength != 200000 {
		t.Errorf("expected default 200000, got %d", ag.config.ContextLength)
	}
}

func TestAgent_SetSession(t *testing.T) {
	ag := NewAgent(AgentConfig{APIKey: "test", Model: "m1", ContextLength: 100})
	ag.SetSession("custom-session")
	if ag.SessionName() != "custom-session" {
		t.Error("session name not updated")
	}
}

func TestAgent_SetModel(t *testing.T) {
	ag := NewAgent(AgentConfig{APIKey: "test", Model: "m1", ContextLength: 100})
	ag.SetModel("new-model", "new-key", "https://new.url", 500000)
	if ag.Model() != "new-model" {
		t.Error("model not updated")
	}
}

func TestAgent_TokenUpdateCallback(t *testing.T) {
	ag := NewAgent(AgentConfig{APIKey: "test", Model: "m1", ContextLength: 100})
	var received int
	ag.OnTokenUpdate(func(total int) { received = total })
	ag.tokenMgr.Add(100, 50, 10, 5)
	if ag.TokenCount() != 165 {
		t.Errorf("expected 165 tokens, got %d", ag.TokenCount())
	}
	_ = received
}

func TestAgent_DisplayChangeCallback(t *testing.T) {
	ag := NewAgent(AgentConfig{APIKey: "test", Model: "m1", ContextLength: 100})
	called := false
	ag.OnDisplayChange(func() { called = true })
	ag.Store().AddUserMessage("hello", "")
	if !called {
		t.Error("display change callback not called")
	}
}

func TestAgent_ClearSession(t *testing.T) {
	ag := NewAgent(AgentConfig{APIKey: "test", Model: "m1", ContextLength: 100})
	ag.Store().AddUserMessage("hello", "")
	ag.tokenMgr.Add(100, 50, 0, 0)
	ag.ClearSession()
	if len(ag.Store().Turns()) != 0 {
		t.Error("store not cleared")
	}
	if ag.TokenCount() != 0 {
		t.Error("tokens not reset")
	}
}

func TestAgent_BuildLLMTools(t *testing.T) {
	ag := NewAgent(AgentConfig{APIKey: "test", Model: "m1", ContextLength: 100})
	ag.tools.Register(NewReadTool())
	ag.tools.Register(NewBashTool())

	tools := ag.buildLLMTools()
	if len(tools) != 2 {
		t.Fatalf("expected 2 tools, got %d", len(tools))
	}
	if tools[0].Name != "Read" {
		t.Errorf("expected Read, got %s", tools[0].Name)
	}
}

func TestAgent_BuildLLMToolsExclude(t *testing.T) {
	ag := NewAgent(AgentConfig{APIKey: "test", Model: "m1", ContextLength: 100, ExcludeTools: []string{"Bash"}})
	ag.tools.Register(NewReadTool())
	ag.tools.Register(NewBashTool())

	tools := ag.buildLLMTools()
	if len(tools) != 1 {
		t.Fatalf("expected 1 tool after exclude, got %d", len(tools))
	}
	if tools[0].Name != "Read" {
		t.Errorf("expected Read, got %s", tools[0].Name)
	}
}

func TestAgent_ExecuteToolsEmpty(t *testing.T) {
	ag := NewAgent(AgentConfig{APIKey: "test", Model: "m1", ContextLength: 100})
	denied, err := ag.executeTools(context.Background(), nil)
	if err != nil {
		t.Fatalf("unexpected error: %s", err)
	}
	if denied {
		t.Error("should not be denied for empty calls")
	}
}

func TestAgent_ExecuteToolsSuccess(t *testing.T) {
	ag := NewAgent(AgentConfig{APIKey: "test", Model: "m1", ContextLength: 100})
	bt := NewBashTool()
	ag.tools.Register(bt)

	calls := []toolCall{{
		Block: ContentBlock{ID: "call_1", Name: "Bash", Input: map[string]any{"command": "echo ok"}},
		Tool:  bt,
	}}
	denied, err := ag.executeTools(context.Background(), calls)
	if err != nil {
		t.Fatalf("unexpected error: %s", err)
	}
	if denied {
		t.Error("should not be denied")
	}
}

func TestAgent_SystemPromptContainsEnvironment(t *testing.T) {
	ag := NewAgent(AgentConfig{APIKey: "test", Model: "m1", ContextLength: 100})
	prompt := ag.SystemPrompt()
	if len(prompt) < 50 {
		t.Error("system prompt too short")
	}
}

func TestAgent_SystemPromptWithUserPrompt(t *testing.T) {
	ag := NewAgent(AgentConfig{
		APIKey:     "test",
		Model:      "m1",
		ContextLength: 100,
		UserPrompt: "custom instructions",
	})
	prompt := ag.SystemPrompt()
	if len(prompt) < 50 {
		t.Error("system prompt with user prompt too short")
	}
}

func TestAgent_Abort(t *testing.T) {
	ag := NewAgent(AgentConfig{APIKey: "test", Model: "m1", ContextLength: 100})
	// Abort should not panic when no run is in progress
	ag.Abort()
}

func TestAgent_IsRunningGuard(t *testing.T) {
	ag := NewAgent(AgentConfig{APIKey: "test", Model: "m1", ContextLength: 100})
	// Run with a context that's already cancelled should return immediately
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	ok, err := ag.Run(ctx, "test")
	if err != nil {
		t.Logf("expected error from cancelled context: %s", err)
	}
	_ = ok
}

func TestToolExecution_AllInputSchemas(t *testing.T) {
	tools := []Tool{
		NewReadTool(), NewWriteTool(), NewEditTool(), NewBashTool(),
		NewSubAgentTool(AgentConfig{APIKey: "test"}),
		NewActivateSkillTool(NewSkillRegistry("/tmp")),
		NewAskUserTool(nil),
		NewSetModelTool(nil),
	}
	for _, tool := range tools {
		schema := tool.InputSchema()
		if schema["type"] != "object" {
			t.Errorf("%s: schema type should be object", tool.Name())
		}
		required, _ := schema["required"].([]string)
		if len(required) == 0 {
			t.Errorf("%s: should have required fields", tool.Name())
		}
	}
}
