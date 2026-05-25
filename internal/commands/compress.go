package commands

func registerCompress(r *Registry) {
	r.Register(&Command{Name: "compress", Description: "Compress conversation history", Kind: Handler,
		Handler: func(args []string, ctx Context) (Result, error) {
			if ctx.Agent != nil {
				ctx.Agent.Compress()
			}
			return HandledResult{}, nil
		},
	})
}
