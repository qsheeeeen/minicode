package commands

import (
	"fmt"

	"minicode/internal/storage"
)

func init() {
	Register(&Command{Name: "resume", Description: "Load a session (without args: list sessions)", Kind: Handler,
		Handler: func(args []string, ctx Context) (Result, error) {
			if len(args) > 0 && ctx.Agent != nil {
				name := args[0]
				if err := ctx.Agent.LoadSession(name); err != nil {
					return StatusResult{Message: fmt.Sprintf("Session not found: %s", name), IsError: true}, nil
				}
				return StatusResult{Message: fmt.Sprintf("Loaded session: %s", name)}, nil
			}
			// List sessions
			sessions := ctx.Sessions
			if sessions == nil {
				sessions = storage.NewSessionManager().List()
			}
			var items []SelectItem
			for _, s := range sessions {
				items = append(items, SelectItem{
					Value:       s.Name,
					Label:       s.Name,
					Description: s.Timestamp.Format("2006-01-02 15:04"),
				})
			}
			if len(items) == 0 {
				return StatusResult{Message: "No sessions found"}, nil
			}
			return SelectResult{Mode: "session-list", Title: "Sessions:", Items: items}, nil
		},
	})
}
