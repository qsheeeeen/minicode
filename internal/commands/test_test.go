package commands

import (
	"strings"
	"testing"
)

func TestTestCmd(t *testing.T) {
	r := NewRegistry()
	r.RegisterBuiltins()
	handled, _, expanded := r.ParseAndExecute("/test", Context{})
	if !handled || !strings.Contains(expanded, "smoke test") {
		t.Error("/test should return test prompt")
	}
}
