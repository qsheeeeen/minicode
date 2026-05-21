package commands

func registerRename(r *Registry) {
	r.Register(&Command{Name: "rename", Description: "Rename current session", Kind: Handler,
		Handler: func(args []string, ctx Context) bool {
			newName := ""
			if len(args) > 0 {
				newName = args[0]
			}
			if newName != "" && ctx.RenameSessionFn != nil && ctx.Agent != nil {
				oldName := ctx.Agent.SessionName()
				_ = ctx.RenameSessionFn(oldName, newName)
				if ctx.SetSessionFn != nil {
					ctx.SetSessionFn(newName)
				}
			}
			return true
		},
	})
}
