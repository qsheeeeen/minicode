package tui

import (
	"fmt"
	"strings"

	"github.com/charmbracelet/bubbles/list"
	tea "github.com/charmbracelet/bubbletea"
	"github.com/charmbracelet/lipgloss"
	"minicode/internal/agent"
	icmd "minicode/internal/commands"
	"minicode/internal/config"
)

// SelectModel holds the state for interactive selection UI (bubbles/list).
type SelectModel struct {
	list list.Model
	mode string // effort-select, session-list, model-tier, ...
	help list.Model

	// Model wizard state machine
	wizardEditTier string
	wizardProvider string

	agent *agent.Agent // set by TUIModel after construction
}

// setMode initializes a bubbles/list for a select mode.
func (sel *SelectModel) setMode(mode, title string, items []icmd.SelectItem, width, height int) {
	listItems := make([]list.Item, len(items))
	for i, it := range items {
		listItems[i] = listItem{title: it.Label, desc: it.Description}
	}

	delegate := list.NewDefaultDelegate()
	delegate.Styles.SelectedTitle = delegate.Styles.SelectedTitle.Foreground(lipgloss.Color("6"))
	delegate.Styles.SelectedDesc = delegate.Styles.SelectedDesc.Foreground(lipgloss.Color("6"))

	l := list.New(listItems, delegate, width-4, height-8)
	l.SetShowTitle(true)
	l.Title = title
	l.SetShowHelp(true)
	l.SetShowStatusBar(false)
	l.SetFilteringEnabled(false)
	l.Styles.Title = styleHeaderCyan

	sel.list = l
	sel.mode = mode
}

func (sel *SelectModel) clearMode() {
	sel.mode = ""
	sel.list = list.Model{}
}

func (sel *SelectModel) active() bool { return sel.mode != "" }

// Update handles list navigation. Returns the selected value on Enter,
// or an empty string if Esc was pressed (selection cancelled).
func (sel *SelectModel) Update(msg tea.KeyMsg) (consumed bool, selected string, cmd tea.Cmd) {
	if !sel.active() {
		return false, "", nil
	}
	switch msg.Type {
	case tea.KeyEsc:
		sel.clearMode()
		return true, "", nil
	case tea.KeyEnter:
		if i, ok := sel.list.SelectedItem().(list.DefaultItem); ok {
			sel.clearMode()
			return true, i.Title(), nil
		}
		return true, "", nil
	}
	var c tea.Cmd
	sel.list, c = sel.list.Update(msg)
	return true, "", c
}

// ---- Model wizard helpers ----

func (sel *SelectModel) handleModelTier(val string) []icmd.SelectItem {
	if val == "_edit_" {
		cfg, _ := config.Load()
		tiers := cfg.Tiers
		if tiers == nil {
			tiers = map[string]string{}
		}
		var items []icmd.SelectItem
		for _, t := range []string{"1", "2", "3"} {
			label := tiers[t]
			if label == "" {
				label = "(unset)"
			}
			items = append(items, icmd.SelectItem{Value: t, Label: t, Description: fmt.Sprintf("Tier %s -> %s", t, label)})
		}
		return items
	}
	return nil // direct tier selection, val is the tier number
}

func (sel *SelectModel) buildProviderItems() []icmd.SelectItem {
	cfg, _ := config.Load()
	var items []icmd.SelectItem
	for k, p := range cfg.Providers {
		if p.APIKey != "" {
			items = append(items, icmd.SelectItem{Value: k, Label: k, Description: p.BaseURL})
		}
	}
	return items
}

func (sel *SelectModel) buildModelItems(providerName string) []icmd.SelectItem {
	cfg, _ := config.Load()
	provider := cfg.Providers[providerName]
	var items []icmd.SelectItem
	for modelName := range provider.Models {
		items = append(items, icmd.SelectItem{Value: modelName, Label: modelName})
	}
	return items
}

func applyModelSpecFn(spec string) (modelName, apiKey, baseURL string, contextLen int) {
	cfg, _ := config.Load()
	parts := strings.SplitN(spec, "@", 2)
	modelName = parts[0]
	providerName := ""
	if len(parts) > 1 {
		providerName = parts[1]
	}
	if providerName == "" {
		for k := range cfg.Providers {
			providerName = k
			break
		}
	}
	provider := cfg.Providers[providerName]
	if info, ok := provider.Models[modelName]; ok {
		contextLen = info.ContextLength
	}
	return modelName, provider.APIKey, provider.BaseURL, contextLen
}
