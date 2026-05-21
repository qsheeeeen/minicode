package skills

import (
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
}

// NewSkillRegistry creates a skill registry for the given directory.
func NewSkillRegistry(dir string) *SkillRegistry {
	return &SkillRegistry{
		skillsDir: dir,
		builtins:  make(map[string]string),
		cache:     make(map[string]string),
	}
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
	}
}

// LoadSkills scans the skills directory for agentSkills.io-format skills.
func (r *SkillRegistry) LoadSkills() error {
	if r.skillsDir != "" {
		entries, err := os.ReadDir(r.skillsDir)
		if err == nil {
			for _, entry := range entries {
				if !entry.IsDir() {
					continue
				}
				skillDir := filepath.Join(r.skillsDir, entry.Name())
				skillFile := filepath.Join(skillDir, "SKILL.md")
				data, err := os.ReadFile(skillFile)
				if err != nil {
					continue
				}
				info := r.parseSkillFrontmatter(string(data))
				if info.Name == "" {
					info.Name = entry.Name()
				}
				r.skills = append(r.skills, info)
				r.cache[info.Name] = string(data)
			}
		}
	}
	return nil
}

// List returns all loaded skills.
func (r *SkillRegistry) List() []SkillInfo {
	return r.skills
}

// GetBody returns the full body (markdown after frontmatter) of a skill.
func (r *SkillRegistry) GetBody(name string) string {
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
