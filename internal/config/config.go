package config

import (
	"fmt"
	"os"
	"path/filepath"

	"github.com/spf13/viper"
)

// ProviderConfig holds configuration for one LLM provider.
type ProviderConfig struct {
	APIKey  string               `mapstructure:"apiKey"`
	BaseURL string               `mapstructure:"baseURL"`
	Models  map[string]ModelInfo `mapstructure:"models"`
}

// ModelInfo holds per-model configuration.
type ModelInfo struct {
	ContextLength int `mapstructure:"contextLength"`
}

// ThinkingConfig holds configuration for thinking models.
type ThinkingConfig struct {
	Enabled      bool   `mapstructure:"enabled"`
	BudgetTokens int    `mapstructure:"budgetTokens"`
	Effort       string `mapstructure:"effort"`
}

// Config is the top-level configuration (~/.minicode/config.json).
type Config struct {
	Providers            map[string]ProviderConfig `mapstructure:"providers"`
	Model                string                    `mapstructure:"model"`
	Tiers                map[string]string         `mapstructure:"tiers"`
	CompressionThreshold float64                   `mapstructure:"compressionThreshold"`
	Thinking             ThinkingConfig            `mapstructure:"thinking"`
	PromptFile           string                    `mapstructure:"promptFile"`
	PermissionMode       string                    `mapstructure:"permissionMode"`
	SkillsDir            string                    `mapstructure:"skillsDir"`
}

// ResolvedConfig is the final runtime configuration after resolution.
type ResolvedConfig struct {
	Model                ModelRef
	CompressionThreshold float64
	Thinking             ThinkingConfig
	PromptFile           string
	PermissionMode       string
	SkillsDir            string
}

// ModelRef identifies a resolved model+provider.
type ModelRef struct {
	Provider      string
	Model         string
	APIKey        string
	BaseURL       string
	ContextLength int
}

var v *viper.Viper

func init() {
	resetViper()
}

func resetViper() {
	v = viper.New()
	v.SetConfigName("config")
	v.SetConfigType("json")

	home, err := os.UserHomeDir()
	if err == nil {
		v.AddConfigPath(filepath.Join(home, ".minicode"))
	}

	// Defaults
	v.SetDefault("compressionThreshold", 0.8)
	v.SetDefault("promptFile", "AGENTS.md")
	v.SetDefault("permissionMode", "manual")
	v.SetDefault("skillsDir", ".minicode/skills")
	v.SetDefault("thinking.budgetTokens", 4096)
}

// Load reads the config file.
func Load() (*Config, error) {
	if err := v.ReadInConfig(); err != nil {
		if _, ok := err.(viper.ConfigFileNotFoundError); !ok {
			return nil, fmt.Errorf("read config: %w", err)
		}
	}

	var cfg Config
	if err := v.Unmarshal(&cfg); err != nil {
		return nil, fmt.Errorf("unmarshal config: %w", err)
	}
	return &cfg, nil
}

// Resolve resolves a model specifier against the config.
func Resolve(specOverride string) (*ResolvedConfig, error) {
	cfg, err := Load()
	if err != nil {
		return nil, err
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
		Thinking:             cfg.Thinking,
		PromptFile:           cfg.PromptFile,
		PermissionMode:       cfg.PermissionMode,
		SkillsDir:            cfg.SkillsDir,
	}

	if spec == "" {
		return resolved, nil
	}

	// Parse model@provider
	parts := split2(spec, "@")
	modelName := parts[0]
	providerName := parts[1]

	if providerName == "" && len(cfg.Providers) > 0 {
		for k := range cfg.Providers {
			providerName = k
			break
		}
	}

	if providerName == "" {
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

// SetModel persists a model specifier.
func SetModel(modelSpec string) error {
	v.Set("model", modelSpec)
	return write()
}

// SetTier persists a tier mapping.
func SetTier(tier, modelSpec string) error {
	tiers := v.GetStringMapString("tiers")
	if tiers == nil {
		tiers = make(map[string]string)
	}
	tiers[tier] = modelSpec
	v.Set("tiers", tiers)
	return write()
}

// SetEffort persists the effort level.
func SetEffort(effort string) error {
	v.Set("thinking.effort", effort)
	return write()
}

func write() error {
	home, err := os.UserHomeDir()
	if err != nil {
		return err
	}
	dir := filepath.Join(home, ".minicode")
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return err
	}
	return v.WriteConfigAs(filepath.Join(dir, "config.json"))
}
