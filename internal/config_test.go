package internal

import "testing"

func TestResolveConfig_EmptyConfig(t *testing.T) {
	resolved, err := ResolveConfig("")
	if err != nil {
		t.Fatalf("unexpected error: %s", err)
	}
	if resolved.CompressionThreshold == 0 {
		t.Error("expected default compression threshold")
	}
	if resolved.PromptFile == "" {
		t.Error("expected default prompt file")
	}
	if resolved.PermissionMode != "manual" {
		t.Errorf("expected manual mode, got %s", resolved.PermissionMode)
	}
}

func TestResolveConfig_Defaults(t *testing.T) {
	resolved, _ := ResolveConfig("")
	if resolved.CompressionThreshold != 0.8 {
		t.Errorf("expected 0.8, got %f", resolved.CompressionThreshold)
	}
	if resolved.PromptFile != "AGENTS.md" {
		t.Errorf("expected AGENTS.md, got %s", resolved.PromptFile)
	}
}

func TestSplit2(t *testing.T) {
	tests := []struct {
		input    string
		expected [2]string
	}{
		{"model@provider", [2]string{"model", "provider"}},
		{"model", [2]string{"model", ""}},
		{"", [2]string{"", ""}},
		{"a@b@c", [2]string{"a", "b@c"}},
	}
	for _, tt := range tests {
		result := split2(tt.input, "@")
		if result != tt.expected {
			t.Errorf("split2(%q) = %v, want %v", tt.input, result, tt.expected)
		}
	}
}

func TestToolSchemaContracts(t *testing.T) {
	tools := []Tool{NewReadTool(), NewWriteTool(), NewEditTool(), NewBashTool()}
	for _, tool := range tools {
		t.Run(tool.Name(), func(t *testing.T) {
			if tool.Name() == "" {
				t.Error("tool name is empty")
			}
			if tool.Description() == "" {
				t.Error("tool description is empty")
			}
			schema := tool.InputSchema()
			if schema["type"] != "object" {
				t.Error("input schema must be object type")
			}
			required, _ := schema["required"].([]string)
			if len(required) == 0 {
				t.Error("tool should have required fields")
			}
		})
	}
}

func TestLLMToolConversion(t *testing.T) {
	r := NewToolRegistry()
	r.Register(NewReadTool())

	all := r.All()
	if len(all) != 1 {
		t.Fatal("expected 1 tool")
	}

	tool := all[0]
	llmTool := LLMTool{
		Name:        tool.Name(),
		Description: tool.Description(),
		InputSchema: tool.InputSchema(),
	}
	if llmTool.Name != "Read" {
		t.Errorf("unexpected name: %s", llmTool.Name)
	}
	if llmTool.InputSchema["type"] != "object" {
		t.Error("schema should be preserved")
	}
}
