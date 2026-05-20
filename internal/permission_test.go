package internal

import "testing"

func TestPermissionService_ManualMode(t *testing.T) {
	ps := NewPermissionService(PermManual)
	allowed, reason := ps.Check("Write", "Write /tmp/test.txt")
	if allowed {
		t.Error("manual mode without promptFn should deny")
	}
	if reason == "" {
		t.Error("expected a reason for denial")
	}
}

func TestPermissionService_YoloMode(t *testing.T) {
	ps := NewPermissionService(PermYolo)
	allowed, _ := ps.Check("Write", "Write /tmp/test.txt")
	if !allowed {
		t.Error("yolo mode should allow all")
	}
}

func TestPermissionService_CycleMode(t *testing.T) {
	ps := NewPermissionService(PermManual)
	if ps.Mode() != PermManual {
		t.Error("expected manual")
	}
	ps.CycleMode()
	if ps.Mode() != PermYolo {
		t.Error("expected yolo after cycle")
	}
	ps.CycleMode()
	if ps.Mode() != PermAuto {
		t.Error("expected auto after 2 cycles")
	}
	ps.CycleMode()
	if ps.Mode() != PermManual {
		t.Error("expected manual after 3 cycles")
	}
}

func TestPermissionService_ManualWithPrompt(t *testing.T) {
	ps := NewPermissionService(PermManual)
	ps.SetPromptFn(func(displayText string) string {
		return "yes"
	})
	allowed, _ := ps.Check("Write", "Write /tmp/test.txt")
	if !allowed {
		t.Error("manual mode with 'yes' prompt should allow")
	}
}

func TestPermissionService_ManualWithYoloPrompt(t *testing.T) {
	ps := NewPermissionService(PermManual)
	ps.SetPromptFn(func(displayText string) string {
		return "yolo"
	})
	ps.Check("Write", "Write /tmp/test.txt")
	if ps.Mode() != PermYolo {
		t.Error("'yolo' answer should switch mode to yolo")
	}
}

func TestPermissionService_ManualWithDeny(t *testing.T) {
	ps := NewPermissionService(PermManual)
	ps.SetPromptFn(func(displayText string) string {
		return "no"
	})
	allowed, reason := ps.Check("Write", "Write /tmp/test.txt")
	if allowed {
		t.Error("'no' answer should deny")
	}
	if reason != "User rejected" {
		t.Errorf("unexpected reason: %s", reason)
	}
}
