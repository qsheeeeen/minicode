package commands

import (
	"strings"

	"minicode/internal/skills"
)

func init() {
	Register(&Command{Name: "skills", Description: "List available skills", Kind: Handler,
		Handler: func(args []string, ctx Context) (Result, error) {
			infos := skills.List()
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
