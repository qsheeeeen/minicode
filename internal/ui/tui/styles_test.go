package tui

import "testing"

func TestStylesDefined(t *testing.T) {
	// Verify key styles are non-nil by checking they can render
	if styleHeaderCyan.Render("test") == "" {
		t.Error("styleHeaderCyan should render")
	}
	if styleDim.Render("test") == "" {
		t.Error("styleDim should render")
	}
	if styleInputBorder.Render("test") == "" {
		t.Error("styleInputBorder should render")
	}
}
