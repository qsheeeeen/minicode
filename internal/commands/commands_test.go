package commands

import (
	"testing"
)

func TestRegistry_RegisterAndGet(t *testing.T) {
	r := newRegistry()
	r.Register(&Command{Name: "mytest", Description: "mytest", Kind: Handler,
		Handler: func(args []string, ctx Context) (Result, error) { return HandledResult{}, nil },
	})
	cmd, ok := r.Get("mytest")
	if !ok || cmd.Name != "mytest" {
		t.Error("expected command to be found")
	}
}

func TestRegistry_GetMissing(t *testing.T) {
	r := newRegistry()
	_, ok := r.Get("nonexistent")
	if ok {
		t.Error("expected false for missing command")
	}
}

func TestRegistry_List(t *testing.T) {
	r := newRegistry()
	r.Register(&Command{Name: "b", Description: "b", Kind: Handler})
	r.Register(&Command{Name: "a", Description: "a", Kind: Handler})
	list := r.List()

	// verify it's sorted
	for i := 0; i < len(list)-1; i++ {
		if list[i].Name > list[i+1].Name {
			t.Errorf("list is not sorted: %s > %s", list[i].Name, list[i+1].Name)
		}
	}

	// verify a and b exist
	foundA, foundB := false, false
	for _, c := range list {
		if c.Name == "a" {
			foundA = true
		}
		if c.Name == "b" {
			foundB = true
		}
	}
	if !foundA || !foundB {
		t.Error("expected a and b in list")
	}
}

func TestRegistry_NonSlashInput(t *testing.T) {
	r := newRegistry()
	handled, _, _ := r.ParseAndExecute("regular text", Context{})
	if handled {
		t.Error("non-slash input should not be handled")
	}
}

func TestRegistry_EmptyInput(t *testing.T) {
	r := newRegistry()
	handled, _, _ := r.ParseAndExecute("", Context{})
	if handled {
		t.Error("empty input should not be handled")
	}
}

func TestRegistry_MissingCommand(t *testing.T) {
	r := newRegistry()
	handled, _, _ := r.ParseAndExecute("/nonexistent", Context{})
	if handled {
		t.Error("missing command should not be handled")
	}
}

func TestAllCommandsRegistered(t *testing.T) {
	expected := []string{
		"clear", "compress", "effort", "exit", "model",
		"new", "plan", "quit", "rename", "resume", "skills", "test",
	}
	for _, name := range expected {
		if _, ok := Get(name); !ok {
			t.Errorf("missing command: /%s", name)
		}
	}
	if len(List()) < 12 {
		t.Errorf("expected at least 12 registered commands (11 + quit alias), got %d", len(List()))
	}
}
