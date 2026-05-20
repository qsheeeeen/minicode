package internal

import (
	"encoding/json"
	"os"
	"path/filepath"
)

// ProviderConfig holds configuration for one LLM provider.
type ProviderConfig struct {
	APIKey  string                `json:"apiKey"`
	BaseURL string                `json:"baseURL"`
	Models  map[string]ModelInfo  `json:"models"`
}

// ModelInfo holds per-model configuration.
type ModelInfo struct {
	ContextLength int `json:"contextLength"`
}

// Config is the top-level configuration (~/.minicode/config.json).
type Config struct {
	Providers           map[string]ProviderConfig `json:"providers"`
	Model               string                    `json:"model"`
	Tiers               map[string]string         `json:"tiers"`
	CompressionThreshold float64                  `json:"compressionThreshold"`
	Thinking            bool                      `json:"thinking"`
	PromptFile          string                    `json:"promptFile"`
	PermissionMode      string                    `json:"permissionMode"`
	SkillsDir           string                    `json:"skillsDir"`
}

// ResolvedConfig is the final runtime configuration after resolution.
type ResolvedConfig struct {
	Model               ModelRef
	CompressionThreshold float64
	PromptFile          string
	PermissionMode      string
	SkillsDir           string
}

// ModelRef identifies a resolved model+provider.
type ModelRef struct {
	Provider     string
	Model        string
	APIKey       string
	BaseURL      string
	ContextLength int
}

// LoadConfig reads the config file from ~/.minicode/config.json.
func LoadConfig() (*Config, error) {
	home, err := os.UserHomeDir()
	if err != nil {
		return &Config{}, nil
	}
	path := filepath.Join(home, ".minicode", "config.json")
	data, err := os.ReadFile(path)
	if err != nil {
		return &Config{}, nil
	}
	var cfg Config
	if err := json.Unmarshal(data, &cfg); err != nil {
		return &Config{}, err
	}
	return &cfg, nil
}

// ResolveConfig resolves a model specifier against the config.
// The spec is "model@provider" format. Falls back to env vars and defaults.
func ResolveConfig(specOverride string) (*ResolvedConfig, error) {
	cfg, err := LoadConfig()
	if err != nil {
		cfg = &Config{}
	}

	spec := specOverride
	if spec == "" {
		spec = os.Getenv("MODEL")
	}
	if spec == "" {
		spec = cfg.Model
	}

	resolved := &ResolvedConfig{
		CompressionThreshold: cfg.CompressionThreshold,
		PromptFile:           cfg.PromptFile,
		PermissionMode:       cfg.PermissionMode,
		SkillsDir:            cfg.SkillsDir,
	}
	if resolved.CompressionThreshold == 0 {
		resolved.CompressionThreshold = 0.8
	}
	if resolved.PromptFile == "" {
		resolved.PromptFile = "AGENTS.md"
	}
	if resolved.PermissionMode == "" {
		resolved.PermissionMode = "manual"
	}
	if resolved.SkillsDir == "" {
		resolved.SkillsDir = ".minicode/skills"
	}

	if spec == "" {
		return resolved, nil
	}

	// Parse model@provider
	parts := split2(spec, "@")
	modelName := parts[0]
	providerName := parts[1]
	if providerName == "" && cfg.Providers != nil {
		// Default to first provider
		for k := range cfg.Providers {
			providerName = k
			break
		}
	}

	if providerName == "" || cfg.Providers == nil {
		return resolved, nil
	}

	provider, ok := cfg.Providers[providerName]
	if !ok || provider.APIKey == "" {
		return resolved, nil
	}

	ref := ModelRef{
		Provider: providerName,
		Model:    modelName,
		APIKey:   provider.APIKey,
		BaseURL:  provider.BaseURL,
	}
	if info, ok := provider.Models[modelName]; ok {
		ref.ContextLength = info.ContextLength
	}
	if ref.ContextLength == 0 {
		ref.ContextLength = 200000
	}
	resolved.Model = ref
	return resolved, nil
}

func split2(s, sep string) [2]string {
	parts := [2]string{}
	for i := 0; i < len(s); i++ {
		if s[i:i+1] == sep {
			parts[0] = s[:i]
			parts[1] = s[i+1:]
			return parts
		}
	}
	parts[0] = s
	return parts
}
