package commands

import (
	"testing"

	"minicode/internal/config"
)

func TestModel(t *testing.T) {
	
	cfg, _ := config.Load()
	handled, result, _ := ParseAndExecute("/model", Context{Config: cfg})
	if !handled {
		t.Error("/model should be handled")
	}
	if _, ok := result.(SelectResult); !ok {
		t.Errorf("/model should return SelectResult, got %T", result)
	}
}
