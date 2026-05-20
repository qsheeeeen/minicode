package internal

import "testing"

func TestAgentRegistry_New(t *testing.T) {
	ag := NewAgent(AgentConfig{APIKey: "test", Model: "test-model", ContextLength: 100})
	r := NewAgentRegistry(ag)
	if r == nil {
		t.Fatal("expected non-nil registry")
	}
	if r.Active() != ag {
		t.Error("initial agent should be active")
	}
}

func TestAgentRegistry_AddAndList(t *testing.T) {
	ag1 := NewAgent(AgentConfig{APIKey: "test", Model: "m1", ContextLength: 100})
	ag2 := NewAgent(AgentConfig{APIKey: "test", Model: "m2", ContextLength: 100})
	r := NewAgentRegistry(ag1)
	r.Add(ag2)

	list := r.List()
	if len(list) != 2 {
		t.Fatalf("expected 2 agents, got %d", len(list))
	}
}

func TestAgentRegistry_NextActive(t *testing.T) {
	ag1 := NewAgent(AgentConfig{APIKey: "test", Model: "m1", ContextLength: 100})
	ag2 := NewAgent(AgentConfig{APIKey: "test", Model: "m2", ContextLength: 100})
	r := NewAgentRegistry(ag1)
	r.Add(ag2)

	if r.Active() != ag1 {
		t.Error("expected ag1 active")
	}
	next := r.NextActive()
	if next != ag2 {
		t.Error("expected ag2 after NextActive")
	}
	if r.Active() != ag2 {
		t.Error("expected ag2 active after cycle")
	}
	next = r.NextActive()
	if next != ag1 {
		t.Error("expected ag1 after second cycle")
	}
}

func TestAgentRegistry_NextActiveSingleAgent(t *testing.T) {
	ag := NewAgent(AgentConfig{APIKey: "test", Model: "m1", ContextLength: 100})
	r := NewAgentRegistry(ag)
	next := r.NextActive()
	if next != ag {
		t.Error("single agent should cycle to itself")
	}
}

func TestToAnySlice(t *testing.T) {
	msgs := []MessageParam{
		{Role: "user", Content: "hello"},
		{Role: "assistant", Content: "hi"},
	}
	result := toAnySlice(msgs)
	if len(result) != 2 {
		t.Fatalf("expected 2, got %d", len(result))
	}
}

func TestMustCwd(t *testing.T) {
	cwd := mustCwd()
	if cwd == "" || cwd == "unknown" {
		t.Error("expected valid cwd")
	}
}

func TestAgent_Accessors(t *testing.T) {
	ag := NewAgent(AgentConfig{
		APIKey: "test-key",
		Model:  "claude-test",
		ContextLength: 100000,
	})
	if ag.Model() != "claude-test" {
		t.Errorf("expected claude-test, got %s", ag.Model())
	}
	if ag.TokenCount() != 0 {
		t.Errorf("expected 0 tokens, got %d", ag.TokenCount())
	}
	if ag.Store() == nil {
		t.Error("store should not be nil")
	}
	if ag.ToolRegistry() == nil {
		t.Error("tool registry should not be nil")
	}
	if ag.SessionName() == "" {
		t.Error("session name should not be empty")
	}
	ag.SetSession("my-session")
	if ag.SessionName() != "my-session" {
		t.Error("session name should be updated")
	}
}

func TestAgent_SetSkills(t *testing.T) {
	ag := NewAgent(AgentConfig{APIKey: "test", Model: "m1", ContextLength: 100})
	sr := NewSkillRegistry("/tmp")
	ag.SetSkills(sr)
	// Verify skills is set (indirectly via the Skills field added to ToolContext during executeTools)
	if ag.skills != sr {
		t.Error("skills should be set")
	}
}

func TestAgent_ClearSession(t *testing.T) {
	ag := NewAgent(AgentConfig{APIKey: "test", Model: "m1", ContextLength: 100})
	ag.Store().AddUserMessage("hello", "")
	if ag.Store().Turns() == nil || len(ag.Store().Turns()) == 0 {
		t.Error("expected messages before clear")
	}
	ag.ClearSession()
	if len(ag.Store().Turns()) != 0 {
		t.Error("expected empty store after clear")
	}
}

func TestActivateSkillTool_MissingSkill(t *testing.T) {
	sr := NewSkillRegistry("/tmp")
	ast := NewActivateSkillTool(sr)
	result, _ := ast.Execute(nil, map[string]any{"name": "nonexistent"}, ToolContext{})
	if result.Output == "" {
		t.Error("expected error output for missing skill")
	}
}

func TestSetModelTool_MissingTier(t *testing.T) {
	smt := NewSetModelTool(nil)
	result, _ := smt.Execute(nil, map[string]any{"tier": "99"}, ToolContext{})
	if result.Output == "" {
		t.Error("expected error output for missing tier")
	}
}

func TestAskUserTool_NoPrompter(t *testing.T) {
	aut := NewAskUserTool(nil)
	result, _ := aut.Execute(nil, map[string]any{
		"question": "test?",
		"options":  []any{map[string]any{"label": "a", "description": "desc a"}},
	}, ToolContext{})
	if result.Output != "Error: No user prompter available" {
		t.Errorf("expected prompter error, got %s", result.Output)
	}
}

func TestAgent_SystemPrompt(t *testing.T) {
	ag := NewAgent(AgentConfig{APIKey: "test", Model: "m1", ContextLength: 100})
	prompt := ag.SystemPrompt()
	if prompt == "" {
		t.Error("system prompt should not be empty")
	}
	if len(prompt) < 100 {
		t.Error("system prompt should be substantial")
	}
}

func TestAgent_TokenCountInitial(t *testing.T) {
	ag := NewAgent(AgentConfig{APIKey: "test", Model: "m1", ContextLength: 100})
	if ag.TokenCount() != 0 {
		t.Error("initial token count should be 0")
	}
}
