package commands

import "testing"

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
