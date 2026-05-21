package commands

func registerModel(r *Registry) {
	r.Register(&Command{Name: "model", Description: "Switch model/provider", Kind: Handler,
		Handler: func(args []string, ctx Context) bool {
			// In TS this shows a model-select UI
			return true
		},
	})
}
