package internal

import "testing"

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
		Prompt: func(args []string) string {
			return "Hello, please greet the user."
		},
	})

	handled, expanded := r.ParseAndExecute("/greet", CommandContext{})
	if !handled {
		t.Error("expected /greet to be handled")
	}
	if expanded != "Hello, please greet the user." {
		t.Errorf("unexpected expansion: %q", expanded)
	}
}

func TestCommandRegistry_NonSlashInput(t *testing.T) {
	r := NewCommandRegistry()
	r.Register(&Command{Name: "test", Description: "test", Kind: CmdHandler, Handler: func(args []string, ctx CommandContext) bool { return true }})

	handled, _ := r.ParseAndExecute("regular text", CommandContext{})
	if handled {
		t.Error("regular text should not be handled as command")
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
