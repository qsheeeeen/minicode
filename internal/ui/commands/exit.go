package commands

func registerExit(r *Registry) {
	r.Register(&Command{Name: "exit", Description: "Exit the application", Kind: Handler,
		Handler: func(args []string, ctx Context) bool {
			if ctx.ExitFn != nil {
				ctx.ExitFn()
			}
			return true
		},
	})
	r.Register(&Command{Name: "quit", Description: "Exit the application", Kind: Handler,
		Handler: func(args []string, ctx Context) bool {
			if ctx.ExitFn != nil {
				ctx.ExitFn()
			}
			return true
		},
	})
}
