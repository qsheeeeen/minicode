package internal

import (
	"os"
	"path/filepath"
	"strings"
)

// SkillInfo is summary metadata for a skill.
type SkillInfo struct {
	Name        string
	Description string
}

// SkillRegistry loads and manages skills from the filesystem.
type SkillRegistry struct {
	skillsDir string
	skills    []SkillInfo
}

// NewSkillRegistry creates a skill registry for the given directory.
func NewSkillRegistry(dir string) *SkillRegistry {
	return &SkillRegistry{skillsDir: dir}
}

// LoadSkills scans the skills directory for agentSkills.io-format skills.
// Each skill is a subdirectory containing a SKILL.md file with YAML frontmatter.
func (r *SkillRegistry) LoadSkills() error {
	if r.skillsDir == "" {
		return nil
	}

	entries, err := os.ReadDir(r.skillsDir)
	if err != nil {
		return nil // directory doesn't exist is not an error
	}

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
		info := parseSkillFrontmatter(string(data))
		if info.Name == "" {
			info.Name = entry.Name()
		}
		r.skills = append(r.skills, info)
	}
	return nil
}

// List returns all loaded skills.
func (r *SkillRegistry) List() []SkillInfo {
	return r.skills
}

// GetBody returns the full body (markdown after frontmatter) of a skill.
func (r *SkillRegistry) GetBody(name string) string {
	skillDir := filepath.Join(r.skillsDir, name)
	skillFile := filepath.Join(skillDir, "SKILL.md")
	data, err := os.ReadFile(skillFile)
	if err != nil {
		return ""
	}
	_, body := splitFrontmatter(string(data))
	return strings.TrimSpace(body)
}

// parseSkillFrontmatter extracts name and description from YAML frontmatter.
// Minimal parser: looks for --- delimited block with name: and description: keys.
func parseSkillFrontmatter(content string) SkillInfo {
	fm, _ := splitFrontmatter(content)
	info := SkillInfo{}
	for _, line := range strings.Split(fm, "\n") {
		line = strings.TrimSpace(line)
		if strings.HasPrefix(line, "name:") {
			info.Name = strings.TrimSpace(strings.TrimPrefix(line, "name:"))
		}
		if strings.HasPrefix(line, "description:") {
			info.Description = strings.TrimSpace(strings.TrimPrefix(line, "description:"))
		}
	}
	return info
}

func splitFrontmatter(content string) (frontmatter, body string) {
	content = strings.TrimSpace(content)
	if !strings.HasPrefix(content, "---") {
		return "", content
	}
	rest := strings.TrimPrefix(content, "---")
	end := strings.Index(rest[1:], "---")
	if end < 0 {
		return "", content
	}
	return strings.TrimSpace(rest[:end+1]), strings.TrimSpace(rest[end+4:])
}
