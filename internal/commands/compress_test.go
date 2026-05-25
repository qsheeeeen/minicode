package commands

import "testing"

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
