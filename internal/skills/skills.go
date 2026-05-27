package skills

import (
	"log/slog"
	"os"
	"path/filepath"
	"strings"

	"gopkg.in/yaml.v3"
)

// SkillInfo is summary metadata for a skill.
type SkillInfo struct {
	Name        string `yaml:"name"`
	Description string `yaml:"description"`
}

// SkillRegistry loads and manages skills from the filesystem.
type SkillRegistry struct {
	skillsDir string
	skills    []SkillInfo
	builtins  map[string]string // name -> body
	cache     map[string]string // name -> body
	logger    *slog.Logger
}

// newSkillRegistry creates a skill registry for the given directory.
func newSkillRegistry(dir string) *SkillRegistry {
	return &SkillRegistry{
		skillsDir: dir,
		builtins:  make(map[string]string),
		cache:     make(map[string]string),
	}
}

func (r *SkillRegistry) log(msg string, attrs ...any) {
	r.logger.Info(msg, attrs...)
}

func (r *SkillRegistry) logErr(msg string, attrs ...any) {
	r.logger.Error(msg, attrs...)
}

// RegisterBuiltin registers a skill from memory.
func (r *SkillRegistry) RegisterBuiltin(body string) {
	info := r.parseSkillFrontmatter(body)
	if info.Name != "" {
		r.builtins[info.Name] = body
		// Add to skills list if not already there
		found := false
		for i, s := range r.skills {
			if s.Name == info.Name {
				r.skills[i] = info
				found = true
				break
			}
		}
		if !found {
			r.skills = append(r.skills, info)
		}
		r.log("builtin skill registered", "name", info.Name)
	}
}

// LoadSkills scans the skills directory for agentSkills.io-format skills.
func (r *SkillRegistry) LoadSkills() error {
	if r.skillsDir != "" {
		r.log("loading skills from directory", "dir", r.skillsDir)
		entries, err := os.ReadDir(r.skillsDir)
		if err != nil {
			r.logErr("failed to read skills directory", "dir", r.skillsDir, "error", err)
			return nil
		}
		for _, entry := range entries {
			if !entry.IsDir() {
				continue
			}
			skillDir := filepath.Join(r.skillsDir, entry.Name())
			skillFile := filepath.Join(skillDir, "SKILL.md")
			data, err := os.ReadFile(skillFile)
			if err != nil {
				r.logErr("failed to read skill file", "file", skillFile, "error", err)
				continue
			}
			info := r.parseSkillFrontmatter(string(data))
			if info.Name == "" {
				info.Name = entry.Name()
			}
			r.skills = append(r.skills, info)
			r.cache[info.Name] = string(data)
			r.log("skill loaded", "name", info.Name, "description", info.Description)
		}
	}
	r.log("skills loading complete", "total", len(r.skills), "builtins", len(r.builtins))
	return nil
}

// List returns all loaded skills.
func (r *SkillRegistry) List() []SkillInfo {
	return r.skills
}

// Body returns the full body (markdown after frontmatter) of a skill.
func (r *SkillRegistry) Body(name string) string {
	// Check builtins
	if body, ok := r.builtins[name]; ok {
		_, content := r.splitFrontmatter(body)
		return strings.TrimSpace(content)
	}

	// Check cache
	if data, ok := r.cache[name]; ok {
		_, body := r.splitFrontmatter(data)
		return strings.TrimSpace(body)
	}

	// Fallback to disk
	skillDir := filepath.Join(r.skillsDir, name)
	skillFile := filepath.Join(skillDir, "SKILL.md")
	data, err := os.ReadFile(skillFile)
	if err != nil {
		return ""
	}
	r.cache[name] = string(data)
	_, body := r.splitFrontmatter(string(data))
	return strings.TrimSpace(body)
}

func (r *SkillRegistry) parseSkillFrontmatter(content string) SkillInfo {
	fm, _ := r.splitFrontmatter(content)
	info := SkillInfo{}
	if fm != "" {
		if err := yaml.Unmarshal([]byte(fm), &info); err != nil {
			// fallback to manual parsing if YAML fails?
			// for now just return empty if it's not valid YAML
		}
	}
	return info
}

func (r *SkillRegistry) splitFrontmatter(content string) (frontmatter, body string) {
	content = strings.TrimSpace(content)
	if !strings.HasPrefix(content, "---") {
		return "", content
	}
	// find second ---
	rest := content[3:]
	idx := strings.Index(rest, "---")
	if idx == -1 {
		return "", content
	}
	return rest[:idx], rest[idx+3:]
}

// Default registry singleton.
var defaultRegistry = func() *SkillRegistry {
	r := newSkillRegistry("")
	r.logger = slog.New(slog.NewTextHandler(os.Stderr, nil))
	return r
}()

// RegisterBuiltin registers a built-in skill to the default registry.
func RegisterBuiltin(body string) { defaultRegistry.RegisterBuiltin(body) }

// LoadSkills scans the skills directory in the default registry.
func LoadSkills(dir string) error {
	defaultRegistry.skillsDir = dir
	return defaultRegistry.LoadSkills()
}

// List returns all loaded skills from the default registry.
func List() []SkillInfo { return defaultRegistry.List() }

// Body returns the full body of a skill from the default registry.
func Body(name string) string { return defaultRegistry.Body(name) }
