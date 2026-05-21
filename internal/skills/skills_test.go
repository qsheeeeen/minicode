package skills

import (
	"strings"
	"testing"
)

func TestSkillRegistry_ParseSkillFrontmatter(t *testing.T) {
	r := NewSkillRegistry("")
	content := `---
name: test-skill
description: "A test skill"
---
Body content`
	info := r.parseSkillFrontmatter(content)
	if info.Name != "test-skill" {
		t.Errorf("expected test-skill, got %s", info.Name)
	}
	if info.Description != "A test skill" {
		t.Errorf("expected A test skill, got %s", info.Description)
	}
}

func TestSkillRegistry_SplitFrontmatter(t *testing.T) {
	r := NewSkillRegistry("")
	content := `---
name: test
---
Body`
	fm, body := r.splitFrontmatter(content)
	if !strings.Contains(fm, "name: test") {
		t.Errorf("expected frontmatter to contain name: test, got %q", fm)
	}
	if strings.TrimSpace(body) != "Body" {
		t.Errorf("expected body to be Body, got %q", body)
	}
}
