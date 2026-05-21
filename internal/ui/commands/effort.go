package commands

func registerEffort(r *Registry) {
	r.Register(&Command{Name: "effort", Description: "Set thinking effort (low|medium|high|xhigh|max)", Kind: Handler,
		Handler: func(args []string, ctx Context) bool {
			valid := map[string]bool{"low": true, "medium": true, "high": true, "xhigh": true, "max": true}
			if len(args) > 0 && valid[args[0]] {
				// Effort accepted — in TS this also persists to config
				return true
			}
			// Invalid or no arg: TS shows effort-select UI
			return true
		},
	})
}
