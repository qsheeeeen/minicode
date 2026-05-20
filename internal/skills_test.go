package internal

import (
	"testing"
)

func TestParseSkillFrontmatter(t *testing.T) {
	content := `---
name: my-skill
description: A test skill
---
This is the skill body.`

	info := parseSkillFrontmatter(content)
	if info.Name != "my-skill" {
		t.Errorf("expected name 'my-skill', got %q", info.Name)
	}
	if info.Description != "A test skill" {
		t.Errorf("expected description, got %q", info.Description)
	}
}

func TestParseSkillFrontmatter_NoFrontmatter(t *testing.T) {
	info := parseSkillFrontmatter("Just a plain text without frontmatter")
	if info.Name != "" {
		t.Error("expected empty name for no frontmatter")
	}
}

func TestSplitFrontmatter(t *testing.T) {
	content := "---\nname: test\n---\nbody here"
	fm, body := splitFrontmatter(content)
	if fm != "name: test" {
		t.Errorf("unexpected frontmatter: %q", fm)
	}
	if body != "body here" {
		t.Errorf("unexpected body: %q", body)
	}
}

func TestSplitFrontmatter_NoDelimiter(t *testing.T) {
	fm, body := splitFrontmatter("no frontmatter here")
	if fm != "" {
		t.Error("expected empty frontmatter")
	}
	if body != "no frontmatter here" {
		t.Errorf("expected full text as body, got %q", body)
	}
}

func TestSkillRegistry_LoadEmpty(t *testing.T) {
	sr := NewSkillRegistry("/nonexistent/dir")
	err := sr.LoadSkills()
	if err != nil {
		t.Fatalf("LoadSkills on nonexistent dir should not error: %s", err)
	}
	if len(sr.List()) != 0 {
		t.Error("expected empty list for nonexistent dir")
	}
}

func TestSkillRegistry_GetBodyMissing(t *testing.T) {
	sr := NewSkillRegistry("/nonexistent/dir")
	body := sr.GetBody("nonexistent")
	if body != "" {
		t.Error("expected empty body for missing skill")
	}
}
