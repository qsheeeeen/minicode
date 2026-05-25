package commands

import "strings"

func registerSkills(r *Registry) {
	r.Register(&Command{Name: "skills", Description: "List available skills", Kind: Handler,
		Handler: func(args []string, ctx Context) (Result, error) {
			if ctx.Agent == nil || ctx.Agent.Skills() == nil {
				return StatusResult{Message: "No skills loaded"}, nil
			}
			infos := ctx.Agent.Skills().List()
			if len(infos) == 0 {
				return StatusResult{Message: "No skills loaded"}, nil
			}
			var names []string
			for _, info := range infos {
				names = append(names, info.Name+": "+info.Description)
			}
			return StatusResult{Message: strings.Join(names, "\n")}, nil
		},
	})
}
