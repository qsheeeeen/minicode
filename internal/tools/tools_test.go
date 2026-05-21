package tools

import (
	"context"
	"testing"

	"minicode/internal/domain"
)

type testTool struct{}

func (t *testTool) Name() string                { return "TestTool" }
func (t *testTool) Description() string         { return "A test tool" }
func (t *testTool) InputSchema() map[string]any { return map[string]any{"type": "object"} }
func (t *testTool) RequiresPermission() bool    { return false }
func (t *testTool) Requires() []ToolRequirement { return nil }
func (t *testTool) Execute(ctx context.Context, args map[string]any, tc ToolContext) (domain.ToolResult, error) {
	return domain.ToolResult{Output: "test output"}, nil
}

func TestToolRegistry_RegisterAndGet(t *testing.T) {
	r := NewToolRegistry()
	r.Register(&testTool{})
	tool, ok := r.Get("TestTool")
	if !ok {
		t.Fatal("expected tool to be found")
	}
	if tool.Name() != "TestTool" {
		t.Errorf("unexpected tool name: %s", tool.Name())
	}
}

func TestToolRegistry_GetMissing(t *testing.T) {
	r := NewToolRegistry()
	_, ok := r.Get("nonexistent")
	if ok {
		t.Error("expected false for missing tool")
	}
}

func TestToolRegistry_All(t *testing.T) {
	r := NewToolRegistry()
	r.Register(&testTool{})
	r.Register(NewReadTool())
	all := r.All()
	if len(all) != 2 {
		t.Fatalf("expected 2 tools, got %d", len(all))
	}
}

func TestToolDeniedError(t *testing.T) {
	err := &ToolDeniedError{ToolName: "Write", Reason: "User rejected"}
	if err.Error() != "tool denied: Write (User rejected)" {
		t.Errorf("unexpected error message: %s", err.Error())
	}
}
