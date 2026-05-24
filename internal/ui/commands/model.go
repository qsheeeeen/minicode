package commands

import (
	"fmt"

	"github.com/charmbracelet/bubbles/list"
)

func registerModel(r *Registry) {
	r.Register(&Command{Name: "model", Description: "Switch model/provider", Kind: Handler,
		Handler: func(args []string, ctx Context) bool {
			if ctx.SetSelectModeFn == nil || ctx.GetConfigFn == nil {
				return true
			}
			cfg := ctx.GetConfigFn()
			tiers := cfg.Tiers
			if tiers == nil {
				tiers = map[string]string{}
			}
			var items []list.Item
			for _, t := range []string{"1", "2", "3"} {
				label := tiers[t]
				if label == "" {
					label = "(unset)"
				}
				items = append(items, modelTierItem{tier: t, label: fmt.Sprintf("Tier %s -> %s", t, label)})
			}
			items = append(items, listItem{title: "_edit_", desc: "Edit tier mapping..."})
			ctx.SetSelectModeFn("model-tier", "Select tier:", items)
			return true
		},
	})
}

type modelTierItem struct {
	tier  string
	label string
}

func (i modelTierItem) Title() string       { return i.label }
func (i modelTierItem) Description() string { return "" }
func (i modelTierItem) FilterValue() string { return i.label }
