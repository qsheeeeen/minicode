package commands

func registerExit(r *Registry) {
	handler := func(args []string, ctx Context) (Result, error) {
		return ExitResult{}, nil
	}
	r.Register(&Command{Name: "exit", Description: "Exit the application", Kind: Handler, Handler: handler})
	r.Register(&Command{Name: "quit", Description: "Exit the application", Kind: Handler, Handler: handler})
}
