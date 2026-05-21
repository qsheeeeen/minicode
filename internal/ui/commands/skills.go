package commands

func registerSkills(r *Registry) {
	r.Register(&Command{Name: "skills", Description: "List available skills", Kind: Handler,
		Handler: func(args []string, ctx Context) bool {
			if ctx.ListSkillsFn != nil {
				ctx.ListSkillsFn()
			}
			return true
		},
	})
}
