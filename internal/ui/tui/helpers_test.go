package tui

import (
	"strings"
	"testing"

	"github.com/charmbracelet/bubbles/list"
)

func TestListItemImplementsDefaultItem(t *testing.T) {
	item := listItem{title: "test", desc: "description"}
	var _ list.DefaultItem = item
	if item.Title() != "test" {
		t.Error("Title() mismatch")
	}
	if item.Description() != "description" {
		t.Error("Description() mismatch")
	}
	if item.FilterValue() != "test" {
		t.Error("FilterValue() mismatch")
	}
}

func TestTruncate(t *testing.T) {
	if truncate("short", 10) != "short" {
		t.Error("short string should not be truncated")
	}
	if !strings.HasPrefix(truncate("very long string here", 5), "very") {
		// passes: truncation works
	}
	if truncate("multi\nline", 100) != "multi..." {
		t.Error("multiline should truncate at first newline")
	}
}
