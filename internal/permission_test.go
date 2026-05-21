package internal

import (
	"strings"
	"testing"
)

func TestPermissionService_GetMode(t *testing.T) {
	ps := NewPermissionService(PermYolo)
	if ps.Mode() != PermYolo {
		t.Errorf("expected yolo, got %s", ps.Mode())
	}
}

func TestPermissionService_SetMode(t *testing.T) {
	ps := NewPermissionService(PermManual)
	ps.SetMode(PermAuto)
	if ps.Mode() != PermAuto {
		t.Errorf("expected auto, got %s", ps.Mode())
	}
}

func TestPermissionService_CycleManualToYolo(t *testing.T) {
	ps := NewPermissionService(PermManual)
	if ps.CycleMode() != PermYolo {
		t.Error("expected yolo after cycle from manual")
	}
}

func TestPermissionService_CycleYoloToAuto(t *testing.T) {
	ps := NewPermissionService(PermYolo)
	if ps.CycleMode() != PermAuto {
		t.Error("expected auto after cycle from yolo")
	}
}

func TestPermissionService_CycleAutoToManual(t *testing.T) {
	ps := NewPermissionService(PermAuto)
	if ps.CycleMode() != PermManual {
		t.Error("expected manual after cycle from auto")
	}
}

func TestPermissionService_CycleThroughAll(t *testing.T) {
	ps := NewPermissionService(PermManual)
	ps.CycleMode()
	ps.CycleMode()
	if ps.CycleMode() != PermManual {
		t.Error("expected manual after full cycle")
	}
}

func TestPermissionService_YoloAlwaysAllowed(t *testing.T) {
	ps := NewPermissionService(PermYolo)
	allowed, _ := ps.Check("Write", "Write /tmp/test.txt", nil)
	if !allowed {
		t.Error("yolo should allow all")
	}
	// Even dangerous commands
	allowed2, _ := ps.Check("Bash", "rm -rf /", nil)
	if !allowed2 {
		t.Error("yolo should allow even dangerous commands")
	}
}

func TestPermissionService_ManualWithPromptYes(t *testing.T) {
	ps := NewPermissionService(PermManual)
	ps.SetPromptFn(func(displayText string) string {
		return "yes"
	})
	allowed, _ := ps.Check("Write", "Write /tmp/test.txt", nil)
	if !allowed {
		t.Error("manual with 'yes' should allow")
	}
}

func TestPermissionService_ManualWithoutPrompter(t *testing.T) {
	ps := NewPermissionService(PermManual)
	allowed, reason := ps.Check("Write", "Write /tmp/test.txt", nil)
	if allowed {
		t.Error("manual without prompter should deny")
	}
	if reason == "" {
		t.Error("should have reason")
	}
}

func TestPermissionService_ManualPromptReturnsNo(t *testing.T) {
	ps := NewPermissionService(PermManual)
	ps.SetPromptFn(func(displayText string) string {
		return "no"
	})
	allowed, reason := ps.Check("Write", "Write /tmp/test.txt", nil)
	if allowed {
		t.Error("'no' should deny")
	}
	if reason != "User rejected" {
		t.Errorf("expected 'User rejected', got %q", reason)
	}
}

func TestPermissionService_ManualPromptReturnsEmpty(t *testing.T) {
	ps := NewPermissionService(PermManual)
	ps.SetPromptFn(func(displayText string) string {
		return ""
	})
	allowed, reason := ps.Check("Write", "Write /tmp/test.txt", nil)
	if allowed {
		t.Error("empty/cancel should deny")
	}
	if reason != "User cancelled" {
		t.Errorf("expected 'User cancelled', got %q", reason)
	}
}

func TestPermissionService_ManualPromptYoloSwitchesMode(t *testing.T) {
	ps := NewPermissionService(PermManual)
	ps.SetPromptFn(func(displayText string) string {
		return "yolo"
	})
	ps.Check("Write", "Write /tmp/test.txt", nil)
	if ps.Mode() != PermYolo {
		t.Error("'yolo' answer should switch mode to yolo")
	}
}

func TestPermissionService_AutoModeAllowRead(t *testing.T) {
	ps := NewPermissionService(PermAuto)
	allowed, _ := ps.Check("Read", "Read file.txt", nil)
	if !allowed {
		t.Error("auto mode should allow Read tool")
	}
}

func TestPermissionService_AutoModeDenyWrite(t *testing.T) {
	ps := NewPermissionService(PermAuto)
	allowed, reason := ps.Check("Write", "Write file.txt", nil)
	if allowed {
		t.Error("auto mode should deny Write (not in allowlist)")
	}
	if reason == "" {
		t.Error("denial should have reason")
	}
}

func TestPermissionService_AutoModeDenyBash(t *testing.T) {
	ps := NewPermissionService(PermAuto)
	// Bash is NOT in isReadTool allowlist anymore for security
	allowed, _ := ps.Check("Bash", "echo hello", nil)
	if allowed {
		t.Error("Bash should be denied in auto mode by default fallback")
	}
}

func TestPermissionService_AutoModeDenyEdit(t *testing.T) {
	ps := NewPermissionService(PermAuto)
	allowed, _ := ps.Check("Edit", "Edit file.txt", nil)
	if allowed {
		t.Error("Edit should not be in isReadTool")
	}
}

func TestPermissionService_InterfaceCheck(t *testing.T) {
	var ps PermissionChecker = NewPermissionService(PermManual)
	if ps == nil {
		t.Error("PermissionService should implement PermissionChecker")
	}
}

func TestPermissionService_DisplayTextPassed(t *testing.T) {
	var receivedText string
	ps := NewPermissionService(PermManual)
	ps.SetPromptFn(func(displayText string) string {
		receivedText = displayText
		return "yes"
	})
	ps.Check("Bash", "echo 'hello world'", nil)
	if !strings.Contains(receivedText, "echo") {
		t.Errorf("display text not passed to prompter: %q", receivedText)
	}
}
