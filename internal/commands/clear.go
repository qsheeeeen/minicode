package commands

import (
	"fmt"
	"time"
)

func registerClear(r *Registry) {
	r.Register(&Command{Name: "clear", Description: "Clear all history and start a new session", Kind: Handler,
		Handler: func(args []string, ctx Context) (Result, error) {
			if ctx.Agent != nil {
				ctx.Agent.ClearSession()
				ctx.Agent.SetSession(fmt.Sprintf("session-%d", time.Now().UnixMilli()))
			}
			return StatusResult{Message: "(Cleared)"}, nil
		},
	})
}
