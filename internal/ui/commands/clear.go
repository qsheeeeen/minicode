package commands

import (
	"fmt"
	"time"
)

func registerClear(r *Registry) {
	r.Register(&Command{Name: "clear", Description: "Clear all history and start a new session", Kind: Handler,
		Handler: func(args []string, ctx Context) bool {
			if ctx.ClearFn != nil {
				ctx.ClearFn()
			}
			if ctx.SetSessionFn != nil {
				ctx.SetSessionFn(fmt.Sprintf("session-%d", time.Now().UnixMilli()))
			}
			if ctx.SetStatusFn != nil {
				ctx.SetStatusFn("(Cleared)")
			}
			return true
		},
	})
}
