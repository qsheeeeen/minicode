package commands

import (
	"strings"
	"testing"
)

func TestPlan(t *testing.T) {
	r := NewRegistry()
	r.RegisterBuiltins()
	handled, _, expanded := r.ParseAndExecute("/plan", Context{})
	if !handled || !strings.Contains(expanded, "executable plan") {
		t.Error("/plan should return plan prompt")
	}
}
