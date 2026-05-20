package internal

import (
	"context"
	"testing"
)

type testTool struct{}

func (t *testTool) Name() string                { return "TestTool" }
func (t *testTool) Description() string         { return "A test tool" }
func (t *testTool) InputSchema() map[string]any { return map[string]any{"type": "object"} }
func (t *testTool) RequiresPermission() bool    { return false }
func (t *testTool) Requires() []ToolRequirement { return nil }
func (t *testTool) Execute(ctx context.Context, args map[string]any, tc ToolContext) (ToolResult, error) {
	return ToolResult{Output: "test output"}, nil
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

func TestReadTool_Execute(t *testing.T) {
	rt := NewReadTool()
	result, err := rt.Execute(context.Background(), map[string]any{"path": "../go.mod"}, ToolContext{})
	if err != nil {
		t.Fatalf("unexpected error: %s", err)
	}
	if result.Output == "" || result.Output == "Error: path is required" {
		t.Errorf("unexpected read output: %s", result.Output)
	}
}

func TestReadTool_MissingPath(t *testing.T) {
	rt := NewReadTool()
	result, _ := rt.Execute(context.Background(), map[string]any{}, ToolContext{})
	if result.Output != "Error: path is required" {
		t.Errorf("expected path required error, got: %s", result.Output)
	}
}

func TestReadTool_WithOffsetLimit(t *testing.T) {
	rt := NewReadTool()
	result, _ := rt.Execute(context.Background(), map[string]any{
		"path":   "../go.mod",
		"offset": float64(1),
		"limit":  float64(1),
	}, ToolContext{})
	if result.Output == "" {
		t.Error("expected output for offset/limit read")
	}
}

func TestBashTool_Execute(t *testing.T) {
	bt := NewBashTool()
	result, _ := bt.Execute(context.Background(), map[string]any{"command": "echo hello"}, ToolContext{})
	if result.Output != "hello" {
		t.Errorf("expected 'hello', got %q", result.Output)
	}
}

func TestBashTool_MissingCommand(t *testing.T) {
	bt := NewBashTool()
	result, _ := bt.Execute(context.Background(), map[string]any{}, ToolContext{})
	if result.Output != "Error: command is required" {
		t.Errorf("expected command required, got: %s", result.Output)
	}
}

func TestToolDeniedError(t *testing.T) {
	err := &ToolDeniedError{ToolName: "Write", Reason: "User rejected"}
	if err.Error() != "tool denied: Write (User rejected)" {
		t.Errorf("unexpected error message: %s", err.Error())
	}
}

func TestWriteTool_NameAndSchema(t *testing.T) {
	wt := NewWriteTool()
	if wt.Name() != "Write" {
		t.Errorf("unexpected name: %s", wt.Name())
	}
	if !wt.RequiresPermission() {
		t.Error("Write tool should require permission")
	}
	schema := wt.InputSchema()
	if schema["type"] != "object" {
		t.Error("unexpected input schema")
	}
}

func TestEditTool_NameAndSchema(t *testing.T) {
	et := NewEditTool()
	if et.Name() != "Edit" {
		t.Errorf("unexpected name: %s", et.Name())
	}
	if !et.RequiresPermission() {
		t.Error("Edit tool should require permission")
	}
}
