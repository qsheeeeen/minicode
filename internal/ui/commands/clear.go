package commands

import "fmt"

func registerClear(r *Registry) {
	r.Register(&Command{Name: "clear", Description: "Clear all history and start a new session", Kind: Handler,
		Handler: func(args []string, ctx Context) bool {
			if ctx.ClearFn != nil {
				ctx.ClearFn()
			}
			if ctx.Agent != nil {
				newSession := fmt.Sprintf("session-%d", 0) // simplified: TS uses Date.now()
				ctx.Agent.SetSession(newSession)
			}
			return true
		},
	})
}
