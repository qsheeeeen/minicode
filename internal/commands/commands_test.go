package commands

import (
	"strings"
	"testing"

	"minicode/internal/agent"
	"minicode/internal/config"
	"minicode/internal/domain"
)

func TestRegistry_RegisterAndGet(t *testing.T) {
	r := NewRegistry()
	r.Register(&Command{Name: "test", Description: "test", Kind: Handler,
		Handler: func(args []string, ctx Context) (Result, error) { return HandledResult{}, nil },
	})
	cmd, ok := r.Get("test")
	if !ok || cmd.Name != "test" {
		t.Error("expected command to be found")
	}
}

func TestRegistry_GetMissing(t *testing.T) {
	r := NewRegistry()
	_, ok := r.Get("nonexistent")
	if ok {
		t.Error("expected false for missing command")
	}
}

func TestRegistry_List(t *testing.T) {
	r := NewRegistry()
	r.Register(&Command{Name: "b", Description: "b", Kind: Handler})
	r.Register(&Command{Name: "a", Description: "a", Kind: Handler})
	list := r.List()
	if len(list) != 2 || list[0].Name != "a" || list[1].Name != "b" {
		t.Errorf("list should be sorted: %v", []string{list[0].Name, list[1].Name})
	}
}

func TestRegistry_NonSlashInput(t *testing.T) {
	r := NewRegistry()
	r.RegisterBuiltins()
	handled, _, _ := r.ParseAndExecute("regular text", Context{})
	if handled {
		t.Error("non-slash input should not be handled")
	}
}

func TestRegistry_EmptyInput(t *testing.T) {
	r := NewRegistry()
	handled, _, _ := r.ParseAndExecute("", Context{})
	if handled {
		t.Error("empty input should not be handled")
	}
}

func TestRegistry_MissingCommand(t *testing.T) {
	r := NewRegistry()
	handled, _, _ := r.ParseAndExecute("/nonexistent", Context{})
	if handled {
		t.Error("missing command should not be handled")
	}
}

// --- Individual command tests ---

func TestExit(t *testing.T) {
	r := NewRegistry()
	r.RegisterBuiltins()
	handled, result, _ := r.ParseAndExecute("/exit", Context{})
	if !handled {
		t.Error("/exit should be handled")
	}
	if _, ok := result.(ExitResult); !ok {
		t.Errorf("/exit should return ExitResult, got %T", result)
	}
}

func TestQuit(t *testing.T) {
	r := NewRegistry()
	r.RegisterBuiltins()
	handled, result, _ := r.ParseAndExecute("/quit", Context{})
	if !handled {
		t.Error("/quit should be handled")
	}
	if _, ok := result.(ExitResult); !ok {
		t.Errorf("/quit should return ExitResult, got %T", result)
	}
}

func TestClear(t *testing.T) {
	r := NewRegistry()
	r.RegisterBuiltins()
	ag := agent.NewAgent(domain.AgentConfig{APIKey: "test", Model: "m1"})
	handled, result, _ := r.ParseAndExecute("/clear", Context{Agent: ag})
	if !handled {
		t.Error("/clear should be handled")
	}
	if sr, ok := result.(StatusResult); !ok || sr.Message != "(Cleared)" {
		t.Errorf("/clear should return StatusResult with '(Cleared)', got %T %s", result, sr.Message)
	}
}

func TestCompress(t *testing.T) {
	r := NewRegistry()
	r.RegisterBuiltins()
	handled, result, _ := r.ParseAndExecute("/compress", Context{})
	if !handled {
		t.Error("/compress should be handled")
	}
	if _, ok := result.(HandledResult); !ok {
		t.Errorf("/compress should return HandledResult, got %T", result)
	}
}

func TestEffort_ValidArg(t *testing.T) {
	t.Setenv("HOME", t.TempDir())
	r := NewRegistry()
	r.RegisterBuiltins()
	handled, result, _ := r.ParseAndExecute("/effort high", Context{})
	if !handled {
		t.Error("/effort high should be handled")
	}
	if sr, ok := result.(StatusResult); !ok || !strings.Contains(sr.Message, "high") {
		t.Errorf("/effort high should set effort, got %T %s", result, sr.Message)
	}
}

func TestEffort_InvalidArg(t *testing.T) {
	r := NewRegistry()
	r.RegisterBuiltins()
	handled, result, _ := r.ParseAndExecute("/effort invalid", Context{})
	if !handled {
		t.Error("/effort invalid should still be handled (shows select UI)")
	}
	if _, ok := result.(SelectResult); !ok {
		t.Errorf("/effort invalid should return SelectResult, got %T", result)
	}
}

func TestEffort_NoArg(t *testing.T) {
	r := NewRegistry()
	r.RegisterBuiltins()
	handled, result, _ := r.ParseAndExecute("/effort", Context{})
	if !handled {
		t.Error("/effort without args should be handled")
	}
	if _, ok := result.(SelectResult); !ok {
		t.Errorf("/effort without args should return SelectResult, got %T", result)
	}
}

func TestNew_WithName(t *testing.T) {
	r := NewRegistry()
	r.RegisterBuiltins()
	ag := agent.NewAgent(domain.AgentConfig{APIKey: "test", Model: "m1"})
	oldSession := ag.SessionName()
	handled, _, _ := r.ParseAndExecute("/new my-session", Context{Agent: ag})
	if !handled {
		t.Error("/new my-session should be handled")
	}
	if ag.SessionName() == oldSession {
		t.Error("/new my-session should change session name")
	}
}

func TestNew_WithoutName(t *testing.T) {
	r := NewRegistry()
	r.RegisterBuiltins()
	ag := agent.NewAgent(domain.AgentConfig{APIKey: "test", Model: "m1"})
	oldSession := ag.SessionName()
	handled, _, _ := r.ParseAndExecute("/new", Context{Agent: ag})
	if !handled {
		t.Error("/new without name should be handled")
	}
	if ag.SessionName() == oldSession {
		t.Error("/new without name should still change session name")
	}
}

func TestRename(t *testing.T) {
	r := NewRegistry()
	r.RegisterBuiltins()
	ag := agent.NewAgent(domain.AgentConfig{APIKey: "test", Model: "m1"})
	ag.SetSession("old-name")
	handled, _, _ := r.ParseAndExecute("/rename new-name", Context{Agent: ag})
	if !handled {
		t.Error("/rename should be handled")
	}
}

func TestRename_EmptyArgs(t *testing.T) {
	r := NewRegistry()
	r.RegisterBuiltins()
	handled, _, _ := r.ParseAndExecute("/rename", Context{})
	if !handled {
		t.Error("/rename without args should be handled (no-op)")
	}
}

func TestResume_List(t *testing.T) {
	r := NewRegistry()
	r.RegisterBuiltins()
	handled, result, _ := r.ParseAndExecute("/resume", Context{})
	if !handled {
		t.Error("/resume without args should list sessions")
	}
	if _, ok := result.(SelectResult); !ok {
		// might be StatusResult("No sessions found") if no sessions exist
		if _, ok := result.(StatusResult); !ok {
			t.Errorf("/resume without args should return SelectResult or StatusResult, got %T", result)
		}
	}
}

func TestResume_WithName(t *testing.T) {
	r := NewRegistry()
	r.RegisterBuiltins()
	ag := agent.NewAgent(domain.AgentConfig{APIKey: "test", Model: "m1"})
	handled, result, _ := r.ParseAndExecute("/resume nonexistent-session", Context{Agent: ag})
	if !handled {
		t.Error("/resume with name should be handled")
	}
	if sr, ok := result.(StatusResult); !ok || !sr.IsError {
		t.Errorf("/resume nonexistent should return error StatusResult, got %T", result)
	}
}

func TestPlan(t *testing.T) {
	r := NewRegistry()
	r.RegisterBuiltins()
	handled, _, expanded := r.ParseAndExecute("/plan", Context{})
	if !handled || !strings.Contains(expanded, "executable plan") {
		t.Error("/plan should return plan prompt")
	}
}

func TestTest(t *testing.T) {
	r := NewRegistry()
	r.RegisterBuiltins()
	handled, _, expanded := r.ParseAndExecute("/test", Context{})
	if !handled || !strings.Contains(expanded, "smoke test") {
		t.Error("/test should return test prompt")
	}
}

func TestSkills(t *testing.T) {
	r := NewRegistry()
	r.RegisterBuiltins()
	ag := agent.NewAgent(domain.AgentConfig{APIKey: "test", Model: "m1"})
	handled, result, _ := r.ParseAndExecute("/skills", Context{Agent: ag})
	if !handled {
		t.Error("/skills should be handled")
	}
	if _, ok := result.(StatusResult); !ok {
		t.Errorf("/skills should return StatusResult, got %T", result)
	}
}

func TestModel(t *testing.T) {
	r := NewRegistry()
	r.RegisterBuiltins()
	cfg, _ := config.Load()
	handled, result, _ := r.ParseAndExecute("/model", Context{Config: cfg})
	if !handled {
		t.Error("/model should be handled")
	}
	if _, ok := result.(SelectResult); !ok {
		t.Errorf("/model should return SelectResult, got %T", result)
	}
}

func TestAllCommandsRegistered(t *testing.T) {
	r := NewRegistry()
	r.RegisterBuiltins()
	expected := []string{
		"clear", "compress", "effort", "exit", "model",
		"new", "plan", "quit", "rename", "resume", "skills", "test",
	}
	for _, name := range expected {
		if _, ok := r.Get(name); !ok {
			t.Errorf("missing command: /%s", name)
		}
	}
	if len(r.List()) != 12 {
		t.Errorf("expected 12 registered commands (11 + quit alias), got %d", len(r.List()))
	}
}
