package commands

import (
	"testing"

	"minicode/internal/config"
)

func TestModel(t *testing.T) {
	r := NewRegistry()
	r.RegisterBuiltins()
	cfg, _ := config.Load()
	handled, result, _ := r.ParseAndExecute("/model", Context{Config: cfg})
	if !handled {
		t.Error("/model should be handled")
	}
	if _, ok := result.(SelectResult); !ok {
		t.Errorf("/model should return SelectResult, got %T", result)
	}
}
