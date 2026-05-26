package commands

import "testing"

func TestCompress(t *testing.T) {

	handled, result, _ := ParseAndExecute("/compress", Context{})
	if !handled {
		t.Error("/compress should be handled")
	}
	if _, ok := result.(HandledResult); !ok {
		t.Errorf("/compress should return HandledResult, got %T", result)
	}
}
