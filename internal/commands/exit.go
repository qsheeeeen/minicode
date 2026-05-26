package commands

func init() {
	handler := func(args []string, ctx Context) (Result, error) {
		return ExitResult{}, nil
	}
	Register(&Command{Name: "exit", Description: "Exit the application", Kind: Handler, Handler: handler})
	Register(&Command{Name: "quit", Description: "Exit the application", Kind: Handler, Handler: handler})
}
