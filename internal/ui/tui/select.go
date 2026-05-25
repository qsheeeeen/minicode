package tui

import (
	"fmt"
	"strings"
	"github.com/charmbracelet/bubbles/list"
	"github.com/charmbracelet/lipgloss"
	icmd "minicode/internal/commands"
	"minicode/internal/config"
	"minicode/internal/domain"
)

// setMode initializes a bubbles/list for a select mode.
func (m *TUIModel) setMode(mode string, title string, items []icmd.SelectItem) {
	// Convert SelectItems to list.DefaultItem for the bubbles list component
	listItems := make([]list.Item, len(items))
	for i, it := range items {
		listItems[i] = listItem{title: it.Label, desc: it.Description}
	}

	delegate := list.NewDefaultDelegate()
	delegate.Styles.SelectedTitle = delegate.Styles.SelectedTitle.Foreground(lipgloss.Color("6"))
	delegate.Styles.SelectedDesc = delegate.Styles.SelectedDesc.Foreground(lipgloss.Color("6"))

	l := list.New(listItems, delegate, m.width-4, m.height-8)
	l.SetShowTitle(true)
	l.Title = title
	l.SetShowHelp(true)
	l.SetShowStatusBar(false)
	l.SetFilteringEnabled(false)
	l.Styles.Title = styleHeaderCyan

	m.selectList = l
	m.selectMode = mode
}

func (m *TUIModel) clearMode() {
	m.selectMode = ""
	m.selectList = list.Model{}
}

func (m *TUIModel) handleSelectChoice(val string) {
	switch m.selectMode {
	case "effort-select":
		config.SetEffort(val)
		m.agent.SetEffort(val)
		m.agent.Store().AddStatus(domain.RoleStatus, fmt.Sprintf("Effort set to: %s", val))
		m.clearMode()
	case "session-list":
		m.clearMode()
		if err := m.agent.LoadSession(val); err != nil {
			m.agent.Store().AddStatus(domain.RoleError, fmt.Sprintf("Session not found: %s", val))
			break
		}
		m.session = val
		m.messages = ToDisplayMessages(m.agent.Store().Turns(), m.agent.Store().Statuses(), m.agent.Store().IsStreaming())
		m.tokenCount = m.agent.TokenCount()
		m.viewport.SetContent(m.renderMessages())
		m.viewport.GotoBottom()
		m.agent.Store().AddStatus(domain.RoleStatus, fmt.Sprintf("Loaded session: %s", val))
	case "model-tier":
		m.handleModelTier(val)
	case "model-edit-tier":
		m.handleModelEditTier(val)
	case "model-provider":
		m.handleModelProvider(val)
	case "model-model":
		m.handleModelSelect(val)
	}
}

func (m *TUIModel) handleModelTier(val string) {
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
		m.setMode("model-edit-tier", "Edit which tier?", items)
		return
	}
	// val is the tier number ("1", "2", "3") directly
	cfg, _ := config.Load()
	spec := ""
	if cfg.Tiers != nil {
		spec = cfg.Tiers[val]
	}
	if spec == "" {
		return
	}
	applyModelSpec(m, spec)
	m.clearMode()
}

func (m *TUIModel) handleModelEditTier(val string) {
	m.modelWizardEditTier = val
	cfg, _ := config.Load()
	var items []icmd.SelectItem
	for k, p := range cfg.Providers {
		if p.APIKey != "" {
			items = append(items, icmd.SelectItem{Value: k, Label: k, Description: p.BaseURL})
		}
	}
	if len(items) == 0 {
		m.agent.Store().AddStatus(domain.RoleError, "No configured providers found")
		m.clearMode()
		return
	}
	m.setMode("model-provider", fmt.Sprintf("Provider for Tier %s:", val), items)
}

func (m *TUIModel) handleModelProvider(val string) {
	m.modelWizardProvider = val
	cfg, _ := config.Load()
	provider := cfg.Providers[val]
	var items []icmd.SelectItem
	for modelName := range provider.Models {
		items = append(items, icmd.SelectItem{Value: modelName, Label: modelName})
	}
	if len(items) == 0 {
		m.agent.Store().AddStatus(domain.RoleError, fmt.Sprintf("No models configured for %s", val))
		m.clearMode()
		return
	}
	m.setMode("model-model", fmt.Sprintf("Model for Tier %s @%s:", m.modelWizardEditTier, val), items)
}

func (m *TUIModel) handleModelSelect(modelName string) {
	spec := modelName + "@" + m.modelWizardProvider
	config.SetTier(m.modelWizardEditTier, spec)
	applyModelSpec(m, spec)
	m.agent.Store().AddStatus(domain.RoleStatus, fmt.Sprintf("Tier %s -> %s", m.modelWizardEditTier, spec))
	m.clearMode()
}

func applyModelSpec(m *TUIModel, spec string) {
	cfg, _ := config.Load()
	parts := strings.SplitN(spec, "@", 2)
	modelName := parts[0]
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
	contextLen := 0
	if info, ok := provider.Models[modelName]; ok {
		contextLen = info.ContextLength
	}
	m.agent.SetModel(spec, provider.APIKey, provider.BaseURL, contextLen)
	config.SetModel(spec)
	m.modelName = modelName
}
