package commands

func registerResume(r *Registry) {
	r.Register(&Command{Name: "resume", Description: "Load a session (without args: list sessions)", Kind: Handler,
		Handler: func(args []string, ctx Context) bool {
			if len(args) == 0 {
				// List sessions — TS shows session-list UI
				if ctx.ListSessionsFn != nil {
					ctx.ListSessionsFn()
				}
				return true
			}
			name := args[0]
			if ctx.LoadSessionFn != nil {
				ctx.LoadSessionFn(name)
			}
			return true
		},
	})
}
