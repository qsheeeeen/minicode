package commands

import "testing"

func TestExit(t *testing.T) {

	handled, result, _ := ParseAndExecute("/exit", Context{})
	if !handled {
		t.Error("/exit should be handled")
	}
	if _, ok := result.(ExitResult); !ok {
		t.Errorf("/exit should return ExitResult, got %T", result)
	}
}

func TestQuit(t *testing.T) {

	handled, result, _ := ParseAndExecute("/quit", Context{})
	if !handled {
		t.Error("/quit should be handled")
	}
	if _, ok := result.(ExitResult); !ok {
		t.Errorf("/quit should return ExitResult, got %T", result)
	}
}
