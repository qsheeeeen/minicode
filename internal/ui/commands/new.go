package commands

import (
	"fmt"
	"time"
)

func registerNew(r *Registry) {
	r.Register(&Command{Name: "new", Description: "Create a new session", Kind: Handler,
		Handler: func(args []string, ctx Context) bool {
			name := ""
			if len(args) > 0 {
				name = args[0]
			}
			if name == "" {
				name = fmt.Sprintf("session-%d", time.Now().UnixMilli())
			}
			if ctx.ClearFn != nil {
				ctx.ClearFn()
			}
			if ctx.SetSessionFn != nil {
				ctx.SetSessionFn(name)
			}
			return true
		},
	})
}
