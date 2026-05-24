package commands

import (
	"strings"
	"testing"

	"minicode/internal/agent"
	"minicode/internal/domain"
)

func TestRegistry_RegisterAndGet(t *testing.T) {
	r := NewRegistry()
	r.Register(&Command{Name: "test", Description: "test", Kind: Handler,
		Handler: func(args []string, ctx Context) bool { return true },
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
	handled, _ := r.ParseAndExecute("regular text", Context{})
	if handled {
		t.Error("non-slash input should not be handled")
	}
}

func TestRegistry_EmptyInput(t *testing.T) {
	r := NewRegistry()
	handled, _ := r.ParseAndExecute("", Context{})
	if handled {
		t.Error("empty input should not be handled")
	}
}

func TestRegistry_MissingCommand(t *testing.T) {
	r := NewRegistry()
	handled, _ := r.ParseAndExecute("/nonexistent", Context{})
	if handled {
		t.Error("missing command should not be handled")
	}
}

// --- Individual command tests ---

func TestExit(t *testing.T) {
	r := NewRegistry()
	r.RegisterBuiltins()
	exited := false
	handled, _ := r.ParseAndExecute("/exit", Context{ExitFn: func() { exited = true }})
	if !handled || !exited {
		t.Error("/exit should call ExitFn")
	}
}

func TestQuit(t *testing.T) {
	r := NewRegistry()
	r.RegisterBuiltins()
	exited := false
	handled, _ := r.ParseAndExecute("/quit", Context{ExitFn: func() { exited = true }})
	if !handled || !exited {
		t.Error("/quit should call ExitFn")
	}
}

func TestClear(t *testing.T) {
	r := NewRegistry()
	r.RegisterBuiltins()
	cleared := false
	handled, _ := r.ParseAndExecute("/clear", Context{ClearFn: func() { cleared = true }})
	if !handled || !cleared {
		t.Error("/clear should call ClearFn")
	}
}

func TestCompress(t *testing.T) {
	r := NewRegistry()
	r.RegisterBuiltins()
	compressed := false
	handled, _ := r.ParseAndExecute("/compress", Context{CompressFn: func() { compressed = true }})
	if !handled || !compressed {
		t.Error("/compress should call CompressFn")
	}
}

func TestEffort_ValidArg(t *testing.T) {
	// Isolate from real ~/.minicode/config.json
	t.Setenv("HOME", t.TempDir())

	r := NewRegistry()
	r.RegisterBuiltins()
	handled, _ := r.ParseAndExecute("/effort high", Context{})
	if !handled {
		t.Error("/effort high should be handled")
	}
}

func TestEffort_InvalidArg(t *testing.T) {
	r := NewRegistry()
	r.RegisterBuiltins()
	handled, _ := r.ParseAndExecute("/effort invalid", Context{})
	if !handled {
		t.Error("/effort invalid should still be handled (shows select UI)")
	}
}

func TestEffort_NoArg(t *testing.T) {
	r := NewRegistry()
	r.RegisterBuiltins()
	handled, _ := r.ParseAndExecute("/effort", Context{})
	if !handled {
		t.Error("/effort without args should be handled")
	}
}

func TestNew_WithName(t *testing.T) {
	r := NewRegistry()
	r.RegisterBuiltins()
	cleared := false
	newSession := ""
	handled, _ := r.ParseAndExecute("/new my-session", Context{
		ClearFn:      func() { cleared = true },
		SetSessionFn: func(name string) { newSession = name },
	})
	if !handled || !cleared || newSession != "my-session" {
		t.Errorf("/new my-session: handled=%v cleared=%v session=%q", handled, cleared, newSession)
	}
}

func TestNew_WithoutName(t *testing.T) {
	r := NewRegistry()
	r.RegisterBuiltins()
	cleared := false
	handled, _ := r.ParseAndExecute("/new", Context{
		ClearFn:      func() { cleared = true },
		SetSessionFn: func(name string) {},
	})
	if !handled || !cleared {
		t.Error("/new without name should still clear")
	}
}

func TestRename(t *testing.T) {
	r := NewRegistry()
	r.RegisterBuiltins()
	called := false
	handled, _ := r.ParseAndExecute("/rename new-name", Context{
		Agent:           agent.NewAgent(domain.AgentConfig{APIKey: "test", Model: "m1"}),
		RenameSessionFn: func(oldName, newName string) error { called = true; return nil },
		SetSessionFn:    func(name string) {},
	})
	if !handled || !called {
		t.Error("/rename should call RenameSessionFn")
	}
}

func TestRename_EmptyArgs(t *testing.T) {
	r := NewRegistry()
	r.RegisterBuiltins()
	handled, _ := r.ParseAndExecute("/rename", Context{})
	if !handled {
		t.Error("/rename without args should be handled (no-op)")
	}
}

func TestResume_List(t *testing.T) {
	r := NewRegistry()
	r.RegisterBuiltins()
	called := false
	handled, _ := r.ParseAndExecute("/resume", Context{
		ListSessionsFn: func() string { called = true; return "" },
	})
	if !handled || !called {
		t.Error("/resume without args should list sessions")
	}
}

func TestResume_WithName(t *testing.T) {
	r := NewRegistry()
	r.RegisterBuiltins()
	loaded := false
	handled, _ := r.ParseAndExecute("/resume my-session", Context{
		LoadSessionFn: func(name string) { loaded = true },
	})
	if !handled || !loaded {
		t.Error("/resume with name should load session")
	}
}

func TestPlan(t *testing.T) {
	r := NewRegistry()
	r.RegisterBuiltins()
	handled, expanded := r.ParseAndExecute("/plan", Context{})
	if !handled || !strings.Contains(expanded, "executable plan") {
		t.Error("/plan should return plan prompt")
	}
}

func TestTest(t *testing.T) {
	r := NewRegistry()
	r.RegisterBuiltins()
	handled, expanded := r.ParseAndExecute("/test", Context{})
	if !handled || !strings.Contains(expanded, "smoke test") {
		t.Error("/test should return test prompt")
	}
}

func TestSkills(t *testing.T) {
	r := NewRegistry()
	r.RegisterBuiltins()
	called := false
	handled, _ := r.ParseAndExecute("/skills", Context{
		ListSkillsFn: func() string { called = true; return "" },
	})
	if !handled || !called {
		t.Error("/skills should call ListSkillsFn")
	}
}

func TestModel(t *testing.T) {
	r := NewRegistry()
	r.RegisterBuiltins()
	handled, _ := r.ParseAndExecute("/model", Context{})
	if !handled {
		t.Error("/model should be handled")
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
	// Also verify count matches TS: 11 unique commands + quit alias = 12 total
	if len(r.List()) != 12 {
		t.Errorf("expected 12 registered commands (11 + quit alias), got %d", len(r.List()))
	}
}
