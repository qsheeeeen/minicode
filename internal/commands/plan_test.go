package commands

import (
	"strings"
	"testing"
)

func TestPlan(t *testing.T) {
	
	handled, _, expanded := ParseAndExecute("/plan", Context{})
	if !handled || !strings.Contains(expanded, "executable plan") {
		t.Error("/plan should return plan prompt")
	}
}
