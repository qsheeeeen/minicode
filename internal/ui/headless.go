package ui

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"strings"

	"minicode/internal/agent"
	"minicode/internal/domain"
)

// RunHeadless executes the agent in headless (non-TUI) mode, streaming output to stdout.
func RunHeadless(ctx context.Context, ag *agent.Agent, initialPrompt, displayPrompt string) error {
	// Set non-interactive prompter for headless mode
	ag.SetAskUserFn(func(question string, options []domain.AskOption, multi bool) string {
		fmt.Fprintf(os.Stderr, "[headless] AskUser tool skipped: %s\n", question)
		return ""
	})

	// Track what has already been printed for incremental rendering
	printedTurns := 0
	printedBlocks := make(map[int]int)      // turnIndex → blocks printed
	streamedChars := make(map[string]int)   // "ti:bi" → chars printed
	finalizedBlocks := make(map[string]bool)
	printedToolUses := make(map[string]bool)
	printedResults := make(map[string]bool)
	printedStatus := make(map[int]bool)

	render := func(isFinal bool) {
		turns := ag.Store().Turns()

		for ti := printedTurns; ti < len(turns); ti++ {
			turn := turns[ti]
			isLastTurn := ti == len(turns)-1

			if turn.Role == "user" {
				content := ""
				if turn.Display != "" {
					content = turn.Display
				} else if s, ok := turn.Content.(string); ok {
					content = s
				}
				if content != "" {
					fmt.Fprintf(os.Stdout, "[user]\n%s\n\n", strings.TrimSpace(content))
				}
				printedTurns = ti + 1
				continue
			}

			if turn.Role != "assistant" {
				continue
			}

			var blocks []domain.ContentBlock
			switch c := turn.Content.(type) {
			case []domain.ContentBlock:
				blocks = c
			case []any:
				for _, raw := range c {
					if m, ok := raw.(map[string]any); ok {
						blocks = append(blocks, domain.ContentBlockFromMap(m))
					}
				}
			}

			bp := printedBlocks[ti]
			for bi := bp; bi < len(blocks); bi++ {
				block := blocks[bi]
				blockKey := fmt.Sprintf("%d:%d", ti, bi)
				isLastBlock := isLastTurn && bi == len(blocks)-1

				switch block.Type {
				case "thinking":
					prevLen := streamedChars[blockKey]
					if len(block.Thinking) > prevLen {
						if prevLen == 0 {
							fmt.Fprint(os.Stdout, "[thinking]\n")
						}
						content := block.Thinking
						if prevLen == 0 {
							content = strings.TrimLeft(content, " \t\n\r")
						} else {
							content = content[prevLen:]
						}
						fmt.Fprint(os.Stdout, content)
						streamedChars[blockKey] = len(block.Thinking)
					}
					if (!isLastBlock || isFinal) && !finalizedBlocks[blockKey] {
						if strings.HasSuffix(block.Thinking, "\n") {
							fmt.Fprint(os.Stdout, "\n")
						} else {
							fmt.Fprint(os.Stdout, "\n\n")
						}
						finalizedBlocks[blockKey] = true
					}
				case "text":
					prevLen := streamedChars[blockKey]
					if len(block.Text) > prevLen {
						if prevLen == 0 {
							fmt.Fprint(os.Stdout, "[assistant]\n")
						}
						content := block.Text
						if prevLen == 0 {
							content = strings.TrimLeft(content, " \t\n\r")
						} else {
							content = content[prevLen:]
						}
						fmt.Fprint(os.Stdout, content)
						streamedChars[blockKey] = len(block.Text)
					}
					if (!isLastBlock || isFinal) && !finalizedBlocks[blockKey] {
						if strings.HasSuffix(block.Text, "\n") {
							fmt.Fprint(os.Stdout, "\n")
						} else {
							fmt.Fprint(os.Stdout, "\n\n")
						}
						finalizedBlocks[blockKey] = true
					}
				case "tool_use":
					if !printedToolUses[block.ID] {
						printedToolUses[block.ID] = true
						fmt.Fprintf(os.Stdout, "[tool] %s(%s)\n", block.Name, domain.JsonString(block.Input))

						// Scan subsequent turns for matching tool_result
						for rti := ti + 1; rti < len(turns); rti++ {
							rt := turns[rti]
							if rt.Role == "user" {
								switch rc := rt.Content.(type) {
								case []domain.ContentBlock:
									for _, rb := range rc {
										if rb.Type == "tool_result" && rb.ToolUseID == block.ID {
											raw := rb.Content
											for _, line := range strings.Split(raw, "\n") {
												if line != "" {
													fmt.Fprintf(os.Stdout, "       %s\n", line)
												}
											}
											if !isLastBlock || isFinal {
												fmt.Fprintln(os.Stdout)
											}
											printedResults[block.ID] = true
										}
									}
								case []any:
									for _, raw := range rc {
										if rb, ok := raw.(map[string]any); ok {
											if rb["type"] == "tool_result" && rb["tool_use_id"] == block.ID {
												var c string
												switch cv := rb["content"].(type) {
												case string:
													c = cv
												default:
													if data, err := json.Marshal(cv); err == nil {
														c = string(data)
													}
												}
												for _, line := range strings.Split(c, "\n") {
													if line != "" {
														fmt.Fprintf(os.Stdout, "       %s\n", line)
													}
												}
												if !isLastBlock || isFinal {
													fmt.Fprintln(os.Stdout)
												}
												printedResults[block.ID] = true
											}
										}
									}
								}
							}
						}
					}
				}
			}

			if !isLastTurn {
				printedBlocks[ti] = len(blocks)
				printedTurns = ti + 1
			} else if isFinal {
				printedBlocks[ti] = len(blocks)
				printedTurns = ti + 1
			} else {
				if len(blocks) > 0 {
					printedBlocks[ti] = len(blocks) - 1
				}
			}
		}

		// Print tool results for any printed tool_use blocks not yet shown
		for _, turn := range turns {
			if turn.Role == "user" {
				switch rc := turn.Content.(type) {
				case []domain.ContentBlock:
					for _, block := range rc {
						if block.Type == "tool_result" && printedToolUses[block.ToolUseID] && !printedResults[block.ToolUseID] {
							printedResults[block.ToolUseID] = true
							for _, line := range strings.Split(block.Content, "\n") {
								if line != "" {
									fmt.Fprintf(os.Stdout, "       %s\n", line)
								}
							}
							fmt.Fprintln(os.Stdout)
						}
					}
				}
			}
		}

		// Print any new status/error messages
		for _, s := range ag.Store().Statuses() {
			statusKey := s.TurnIndex*1000000 + int(s.Timestamp.Unix())%1000000
			if !printedStatus[statusKey] {
				printedStatus[statusKey] = true
				if s.Role == domain.RoleError {
					fmt.Fprintf(os.Stderr, "[error] %s\n", s.Content)
				}
			}
		}
	}

	ag.OnDisplayChange(func() { render(false) })

	ok, err := ag.Run(ctx, initialPrompt, displayPrompt)
	if err != nil {
		return err
	}
	_ = ok
	render(true)
	return nil
}
