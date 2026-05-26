package commands

import (
	"fmt"
	"time"
)

func init() {
	handler := func(args []string, ctx Context) (Result, error) {
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
		return StatusResult{Message: "(Cleared and started new session: " + name + ")"}, nil
	}

	Register(&Command{Name: "new", Description: "Start a new session", Kind: Handler, Handler: handler})
	Register(&Command{Name: "clear", Description: "Clear all history and start a new session", Kind: Handler, Handler: handler})
}
