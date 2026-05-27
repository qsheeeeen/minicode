package config

import (
	"os"
	"path/filepath"
	"testing"
)

func TestResolveConfig_EmptyConfig(t *testing.T) {
	resolved, err := Resolve("")
	if err != nil {
		t.Fatalf("unexpected error: %s", err)
	}
	if resolved.CompressionThreshold == 0 {
		t.Error("expected default compression threshold")
	}
	if resolved.PermissionMode != "manual" {
		t.Errorf("expected manual mode, got %s", resolved.PermissionMode)
	}
}

func TestResolveConfig_Defaults(t *testing.T) {
	origHome := os.Getenv("HOME")
	os.Setenv("HOME", "/nonexistent")
	defer os.Setenv("HOME", origHome)

	// Need fresh viper since we changed HOME
	resetViper()

	resolved, _ := Resolve("")
	if resolved.CompressionThreshold != 0.8 {
		t.Errorf("expected 0.8, got %f", resolved.CompressionThreshold)
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

func TestResolveConfig_NoConfigFile(t *testing.T) {
	// Temporarily override HOME so config file isn't found
	origHome := os.Getenv("HOME")
	os.Setenv("HOME", "/nonexistent")
	defer os.Setenv("HOME", origHome)

	resolved, err := Resolve("")
	if err != nil {
		t.Fatalf("unexpected error: %s", err)
	}
	// Should still get defaults
	if resolved.CompressionThreshold != 0.8 {
		t.Errorf("expected 0.8, got %f", resolved.CompressionThreshold)
	}
}

func TestConfig_Tiers(t *testing.T) {
	cfg := Config{Tiers: map[string]string{"1": "claude-sonnet@anthropic", "2": "glm-4.7@zhipu"}}
	if cfg.Tiers["1"] != "claude-sonnet@anthropic" {
		t.Error("tier 1 mismatch")
	}
	if cfg.Tiers["2"] != "glm-4.7@zhipu" {
		t.Error("tier 2 mismatch")
	}
}

func TestLoadConfig_NoFile(t *testing.T) {
	origHome := os.Getenv("HOME")
	os.Setenv("HOME", "/nonexistent")
	defer os.Setenv("HOME", origHome)

	cfg, err := Load()
	if err != nil {
		t.Fatalf("unexpected error: %s", err)
	}
	if cfg == nil {
		t.Fatal("expected non-nil config")
	}
}

func TestLoadConfig_WithFile(t *testing.T) {
	// Create temp config
	tmpDir := t.TempDir()
	minicodeDir := filepath.Join(tmpDir, ".minicode")
	os.MkdirAll(minicodeDir, 0o755)
	configPath := filepath.Join(minicodeDir, "config.json")
	configJSON := `{"model": "test-model@test", "tiers": {"1": "sonnet@ant"}}`
	os.WriteFile(configPath, []byte(configJSON), 0o644)

	// Explicitly tell our viper instance where the config is
	v.SetConfigFile(configPath)
	defer resetViper()

	cfg, err := Load()
	if err != nil {
		t.Fatalf("unexpected error: %s", err)
	}
	if cfg.Model != "test-model@test" {
		t.Errorf("expected test-model@test, got %s", cfg.Model)
	}
	if cfg.Tiers["1"] != "sonnet@ant" {
		t.Errorf("expected tier 1 value, got %s", cfg.Tiers["1"])
	}
}

func TestResolvedConfig_Fields(t *testing.T) {
	resolved, _ := Resolve("unknown-model@unknown-provider")
	if resolved.PermissionMode != "manual" {
		t.Errorf("expected manual, got %s", resolved.PermissionMode)
	}
	// With an unknown provider, model should have empty APIKey
	if resolved.Model.APIKey != "" {
		t.Error("model should have empty APIKey for unknown provider")
	}
}

func TestModelRef_ZeroValue(t *testing.T) {
	var ref ModelRef
	if ref.Provider != "" {
		t.Error("zero value Provider should be empty")
	}
	if ref.ContextLength != 0 {
		t.Error("zero value ContextLength should be 0")
	}
}
