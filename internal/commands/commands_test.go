package commands

import (
	"testing"
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
