package commands

func init() {
	Register(&Command{Name: "test", Description: "Run a simple test across all available tools", Kind: Prompt,
		Prompt: func(args []string) string {
			return "Ignore the project context. Run a simple smoke test of your available tools, use each tool once with minimal inputs, and report pass/fail for each."
		},
	})
}
