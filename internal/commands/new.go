package commands

import (
	"fmt"
	"time"
)

func init() {
	Register(&Command{Name: "new", Description: "Create a new session", Kind: Handler,
		Handler: func(args []string, ctx Context) (Result, error) {
			name := ""
			if len(args) > 0 {
				name = args[0]
			}
			if name == "" {
				name = fmt.Sprintf("session-%d", time.Now().UnixMilli())
			}
			if ctx.Agent != nil {
				ctx.Agent.ClearSession()
				ctx.Agent.SetSession(name)
			}
			return HandledResult{}, nil
		},
	})
}
