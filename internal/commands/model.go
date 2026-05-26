package commands

import (
	"fmt"
)

func init() {
	Register(&Command{Name: "model", Description: "Switch model/provider", Kind: Handler,
		Handler: func(args []string, ctx Context) (Result, error) {
			cfg := ctx.Config
			if cfg == nil {
				return StatusResult{Message: "No config loaded", IsError: true}, nil
			}
			tiers := cfg.Tiers
			if tiers == nil {
				tiers = map[string]string{}
			}
			var items []SelectItem
			for _, t := range []string{"1", "2", "3"} {
				label := tiers[t]
				if label == "" {
					label = "(unset)"
				}
				items = append(items, SelectItem{
					Value: t,
					Label: fmt.Sprintf("Tier %s -> %s", t, label),
				})
			}
			items = append(items, SelectItem{Value: "_edit_", Label: "_edit_", Description: "Edit tier mapping..."})
			return SelectResult{Mode: "model-tier", Title: "Select tier:", Items: items}, nil
		},
	})
}
