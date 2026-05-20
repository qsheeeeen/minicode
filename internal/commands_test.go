package internal

import (
	"strings"
	"testing"
)

func TestCommandRegistry_ParseSlashCommand(t *testing.T) {
	executed := false
	r := NewCommandRegistry()
	r.Register(&Command{Name: "test", Description: "test command", Kind: CmdHandler,
		Handler: func(args []string, ctx CommandContext) bool {
			executed = true
			return true
		},
	})
	handled, _ := r.ParseAndExecute("/test", CommandContext{})
	if !handled {
		t.Error("expected /test to be handled")
	}
	if !executed {
		t.Error("expected handler to be called")
	}
}

func TestCommandRegistry_PromptExpansion(t *testing.T) {
	r := NewCommandRegistry()
	r.Register(&Command{Name: "greet", Description: "greet someone", Kind: CmdPrompt,
		Prompt: func(args []string) string { return "Hello, please greet." },
	})
	handled, expanded := r.ParseAndExecute("/greet", CommandContext{})
	if !handled {
		t.Error("expected /greet to be handled")
	}
	if expanded != "Hello, please greet." {
		t.Errorf("unexpected expansion: %q", expanded)
	}
}

func TestCommandRegistry_NonSlashInput(t *testing.T) {
	r := NewCommandRegistry()
	r.Register(&Command{Name: "test", Description: "test", Kind: CmdHandler,
		Handler: func(args []string, ctx CommandContext) bool { return true }})
	handled, _ := r.ParseAndExecute("regular text", CommandContext{})
	if handled {
		t.Error("regular text should not be handled")
	}
}

func TestCommandRegistry_EmptyInput(t *testing.T) {
	r := NewCommandRegistry()
	handled, _ := r.ParseAndExecute("", CommandContext{})
	if handled {
		t.Error("empty input should not be handled")
	}
}

func TestCommandRegistry_MissingCommand(t *testing.T) {
	r := NewCommandRegistry()
	handled, _ := r.ParseAndExecute("/nonexistent", CommandContext{})
	if handled {
		t.Error("missing command should not be handled")
	}
}

func TestCommandRegistry_Exit(t *testing.T) {
	r := NewCommandRegistry()
	exited := false
	RegisterBuiltinCommands(r)
	handled, _ := r.ParseAndExecute("/exit", CommandContext{
		ExitFn: func() { exited = true },
	})
	if !handled {
		t.Error("expected /exit to be handled")
	}
	if !exited {
		t.Error("expected exit function to be called")
	}
}

func TestCommandRegistry_Clear(t *testing.T) {
	r := NewCommandRegistry()
	cleared := false
	RegisterBuiltinCommands(r)
	handled, _ := r.ParseAndExecute("/clear", CommandContext{
		ClearFn: func() { cleared = true },
	})
	if !handled {
		t.Error("expected /clear to be handled")
	}
	if !cleared {
		t.Error("expected clear function to be called")
	}
}

func TestCommandRegistry_Plan(t *testing.T) {
	r := NewCommandRegistry()
	RegisterBuiltinCommands(r)
	handled, expanded := r.ParseAndExecute("/plan", CommandContext{})
	if !handled {
		t.Error("expected /plan to be handled")
	}
	if !strings.Contains(expanded, "implementation plan") {
		t.Errorf("/plan expansion should mention plan, got: %s", expanded)
	}
}

func TestCommandRegistry_Test(t *testing.T) {
	r := NewCommandRegistry()
	RegisterBuiltinCommands(r)
	handled, expanded := r.ParseAndExecute("/test", CommandContext{})
	if !handled {
		t.Error("expected /test to be handled")
	}
	if !strings.Contains(expanded, "smoke test") {
		t.Errorf("/test expansion should mention smoke test, got: %s", expanded)
	}
}

func TestCommandRegistry_WithArgs(t *testing.T) {
	r := NewCommandRegistry()
	var receivedArgs []string
	r.Register(&Command{Name: "echo", Description: "echo args", Kind: CmdHandler,
		Handler: func(args []string, ctx CommandContext) bool {
			receivedArgs = args
			return true
		},
	})
	handled, _ := r.ParseAndExecute("/echo hello world", CommandContext{})
	if !handled {
		t.Error("expected /echo to be handled")
	}
	if len(receivedArgs) != 1 || receivedArgs[0] != "hello world" {
		t.Errorf("unexpected args: %v", receivedArgs)
	}
}

func TestCommandRegistry_MultipleArgs(t *testing.T) {
	r := NewCommandRegistry()
	var receivedArgs []string
	r.Register(&Command{Name: "cmd", Description: "cmd", Kind: CmdHandler,
		Handler: func(args []string, ctx CommandContext) bool {
			receivedArgs = args
			return true
		},
	})
	r.ParseAndExecute("/cmd arg1 arg2", CommandContext{})
	if len(receivedArgs) != 1 || receivedArgs[0] != "arg1 arg2" {
		t.Errorf("unexpected args: %v", receivedArgs)
	}
}

func TestCommandRegistry_TrimsWhitespace(t *testing.T) {
	r := NewCommandRegistry()
	var receivedArgs []string
	r.Register(&Command{Name: "cmd", Description: "cmd", Kind: CmdHandler,
		Handler: func(args []string, ctx CommandContext) bool {
			receivedArgs = args
			return true
		},
	})
	r.ParseAndExecute("/cmd  arg1  ", CommandContext{})
	if len(receivedArgs) != 1 || receivedArgs[0] != "arg1  " {
		t.Logf("args: %v", receivedArgs)
	}
}

func TestCommandRegistry_Register(t *testing.T) {
	r := NewCommandRegistry()
	r.Register(&Command{Name: "my-cmd", Description: "My command", Kind: CmdHandler,
		Handler: func(args []string, ctx CommandContext) bool { return true }})
	cmd, ok := r.Get("my-cmd")
	if !ok {
		t.Error("command should be registered")
	}
	if cmd.Description != "My command" {
		t.Error("command description mismatch")
	}
}

func TestCommandRegistry_GetNames(t *testing.T) {
	r := NewCommandRegistry()
	RegisterBuiltinCommands(r)
	r.Register(&Command{Name: "extra", Description: "extra", Kind: CmdHandler,
		Handler: func(args []string, ctx CommandContext) bool { return true }})

	// All builtin commands should exist
	for _, name := range []string{"exit", "clear", "plan", "test"} {
		if _, ok := r.Get(name); !ok {
			t.Errorf("expected builtin command %q to exist", name)
		}
	}
	if _, ok := r.Get("extra"); !ok {
		t.Error("expected extra command to exist")
	}
}

func TestCommandRegistry_RegisterHandler(t *testing.T) {
	r := NewCommandRegistry()
	called := false
	r.Register(&Command{Name: "h", Description: "", Kind: CmdHandler,
		Handler: func(args []string, ctx CommandContext) bool { called = true; return true }})
	handled, prompt := r.ParseAndExecute("/h", CommandContext{})
	if !handled || prompt != "" {
		t.Error("handler should be called, no prompt")
	}
	if !called {
		t.Error("handler not called")
	}
}

func TestCommandRegistry_RegisterPrompt(t *testing.T) {
	r := NewCommandRegistry()
	r.Register(&Command{Name: "p", Description: "", Kind: CmdPrompt,
		Prompt: func(args []string) string { return "expanded prompt content" }})
	handled, prompt := r.ParseAndExecute("/p", CommandContext{})
	if !handled || prompt != "expanded prompt content" {
		t.Errorf("expected prompt expansion, got handled=%v prompt=%q", handled, prompt)
	}
}
