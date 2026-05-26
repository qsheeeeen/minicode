package commands

import (
	"strings"
	"testing"
)

func TestTestCmd(t *testing.T) {
	
	handled, _, expanded := ParseAndExecute("/test", Context{})
	if !handled || !strings.Contains(expanded, "smoke test") {
		t.Error("/test should return test prompt")
	}
}
