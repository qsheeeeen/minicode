package commands

import "minicode/internal/storage"

func registerRename(r *Registry) {
	r.Register(&Command{Name: "rename", Description: "Rename current session", Kind: Handler,
		Handler: func(args []string, ctx Context) (Result, error) {
			newName := ""
			if len(args) > 0 {
				newName = args[0]
			}
			if newName != "" && ctx.Agent != nil {
				oldName := ctx.Agent.SessionName()
				_ = storage.NewSessionManager().Rename(oldName, newName)
				ctx.Agent.SetSession(newName)
			}
			return HandledResult{}, nil
		},
	})
}
