package commands

import (
	"strings"
	"testing"
)

func TestEffort_ValidArg(t *testing.T) {
	t.Setenv("HOME", t.TempDir())
	r := NewRegistry()
	r.RegisterBuiltins()
	handled, result, _ := r.ParseAndExecute("/effort high", Context{})
	if !handled {
		t.Error("/effort high should be handled")
	}
	if sr, ok := result.(StatusResult); !ok || !strings.Contains(sr.Message, "high") {
		t.Errorf("/effort high should set effort, got %T %s", result, sr.Message)
	}
}

func TestEffort_InvalidArg(t *testing.T) {
	r := NewRegistry()
	r.RegisterBuiltins()
	handled, result, _ := r.ParseAndExecute("/effort invalid", Context{})
	if !handled {
		t.Error("/effort invalid should still be handled (shows select UI)")
	}
	if _, ok := result.(SelectResult); !ok {
		t.Errorf("/effort invalid should return SelectResult, got %T", result)
	}
}

func TestEffort_NoArg(t *testing.T) {
	r := NewRegistry()
	r.RegisterBuiltins()
	handled, result, _ := r.ParseAndExecute("/effort", Context{})
	if !handled {
		t.Error("/effort without args should be handled")
	}
	if _, ok := result.(SelectResult); !ok {
		t.Errorf("/effort without args should return SelectResult, got %T", result)
	}
}
