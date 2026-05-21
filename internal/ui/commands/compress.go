package commands

func registerCompress(r *Registry) {
	r.Register(&Command{Name: "compress", Description: "Compress conversation history", Kind: Handler,
		Handler: func(args []string, ctx Context) bool {
			if ctx.CompressFn != nil {
				ctx.CompressFn()
			}
			return true
		},
	})
}
