package commands

import (
	"fmt"

	"minicode/internal/config"
)

func registerEffort(r *Registry) {
	r.Register(&Command{Name: "effort", Description: "Set thinking effort (low|medium|high|xhigh|max)", Kind: Handler,
		Handler: func(args []string, ctx Context) (Result, error) {
			valid := map[string]bool{"low": true, "medium": true, "high": true, "xhigh": true, "max": true}
			if len(args) > 0 && valid[args[0]] {
				config.SetEffort(args[0])
				if ctx.Agent != nil {
					ctx.Agent.SetEffort(args[0])
				}
				return StatusResult{Message: fmt.Sprintf("Effort set to: %s", args[0])}, nil
			}
			// Show selection UI
			efforts := []string{"low", "medium", "high", "xhigh", "max"}
			descs := []string{"Minimal thinking", "Balanced", "Thorough reasoning", "Very thorough", "Maximum effort"}
			items := make([]SelectItem, len(efforts))
			for i, e := range efforts {
				items[i] = SelectItem{Value: e, Label: e, Description: descs[i]}
			}
			return SelectResult{Mode: "effort-select", Title: "Effort:", Items: items}, nil
		},
	})
}
