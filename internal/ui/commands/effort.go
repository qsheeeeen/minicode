package commands

import (
	"fmt"

	"github.com/charmbracelet/bubbles/list"
	"minicode/internal/config"
)

func registerEffort(r *Registry) {
	r.Register(&Command{Name: "effort", Description: "Set thinking effort (low|medium|high|xhigh|max)", Kind: Handler,
		Handler: func(args []string, ctx Context) bool {
			valid := map[string]bool{"low": true, "medium": true, "high": true, "xhigh": true, "max": true}
			if len(args) > 0 && valid[args[0]] {
				config.SetEffort(args[0])
				if ctx.SetStatusFn != nil {
					ctx.SetStatusFn(fmt.Sprintf("Effort set to: %s", args[0]))
				}
				return true
			}
			// No/invalid arg: show effort selection UI
			if ctx.SetSelectModeFn != nil {
				items := []list.Item{
					listItem{title: "low", desc: "Minimal thinking"},
					listItem{title: "medium", desc: "Balanced"},
					listItem{title: "high", desc: "Thorough reasoning"},
					listItem{title: "xhigh", desc: "Very thorough"},
					listItem{title: "max", desc: "Maximum effort"},
				}
				ctx.SetSelectModeFn("effort-select", "Effort:", items)
			}
			return true
		},
	})
}

type listItem struct {
	title string
	desc  string
}

func (i listItem) Title() string       { return i.title }
func (i listItem) Description() string { return i.desc }
func (i listItem) FilterValue() string { return i.title }
