// Package agent implements the core Agent loop: user input → LLM → tools → repeat.
package agent

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"os"
	"os/exec"
	"sync"
	"time"

	"minicode/internal/llm"
	"minicode/internal/messages"
	"minicode/internal/session"
	"minicode/internal/tools"
)

// SystemPrompt is the base system prompt (mirrors TypeScript version).
const SystemPrompt = `你是一个交互式 CLI 编程智能体，帮助用户完成软件工程任务。请使用以下指令和可用工具来协助用户。

# 指南：
- 使用用户的语言
- 使用 Bash 进行文件操作，如 ls、grep、find
- 编辑文件前先用 Read 查看
- 使用 Edit 进行精确修改（旧文本必须完全匹配）
- 仅在创建新文件或完全重写时使用 Write
- 总结操作时直接输出纯文本——不要用 cat 或 Bash 来展示你做了什么
- 回复保持简洁严谨——不要使用比喻
- 操作文件时清晰展示文件路径
- 在操作前评估影响范围，和用户确认不可逆的操作，用户的确认单次生效
- 你可以在单次响应中调用多个工具
- 适当地并行来提高效率`

// Config holds Agent configuration.
type Config struct {
	APIKey                    string
	BaseURL                   string
	Model                     string
	ContextLength             int
	CompressionThresholdRatio float64
	ThinkingEnabled           bool
	UserPrompt                string
	ProjectPromptFile         string
	ExcludeTools              []string
}

// TokenEvent is emitted when token counts change.
type TokenEvent struct {
	Total int
}

// StatusEvent is emitted for status/error display.
type StatusEvent struct {
	Role    string // "status" | "error"
	Content string
}

// DisplayChange is emitted whenever the message store changes.
type DisplayChange struct {
	Messages []messages.DisplayMessage
}

// Agent orchestrates the conversation loop.
type Agent struct {
	client  *llm.Client
	config  Config
	store   *messages.Store
	tools   *tools.Registry
	session *session.Manager

	sessionName string
	logger      *slog.Logger
	tokenCount  int
	totalTokens int
	threshold   int // last shown % threshold

	mu              sync.Mutex
	cancelFunc      context.CancelFunc
	isRunning       bool
	isCompressing   bool
	saveSessionLock sync.Mutex

	// Callbacks for TUI integration
	onTokenUpdate   func(total int)
	onStatusUpdate  func(role, content string)
	onDisplayChange func()

	// Environment context (git status etc.)
	environmentContext string
	systemPrompt       string
}

// New creates a new Agent with default settings.
func New(cfg Config) *Agent {
	if cfg.ContextLength == 0 {
		cfg.ContextLength = 200000
	}
	if cfg.CompressionThresholdRatio == 0 {
		cfg.CompressionThresholdRatio = 0.8
	}

	a := &Agent{
		client:  llm.NewClient(cfg.APIKey, cfg.BaseURL),
		config:  cfg,
		store:   messages.NewStore(),
		tools:   tools.NewRegistry(),
		session: session.NewManager(),
		logger:  slog.New(slog.NewTextHandler(os.Stderr, nil)),
		sessionName: fmt.Sprintf("session-%d", time.Now().UnixMilli()),
	}

	a.refreshEnvironment()
	a.refreshSystemPrompt()
	return a
}

// --- Callback registration (for TUI) ---

// OnTokenUpdate registers a callback for token count changes.
func (a *Agent) OnTokenUpdate(fn func(total int)) {
	a.onTokenUpdate = fn
}

// OnStatusUpdate registers a callback for status/error messages.
func (a *Agent) OnStatusUpdate(fn func(role, content string)) {
	a.onStatusUpdate = fn
}

// OnDisplayChange registers a callback for message store changes.
func (a *Agent) OnDisplayChange(fn func()) {
	a.onDisplayChange = fn
	a.store.OnChange(fn)
}

// --- Accessors ---

// Store returns the message store.
func (a *Agent) Store() *messages.Store { return a.store }

// ToolRegistry returns the tool registry.
func (a *Agent) ToolRegistry() *tools.Registry { return a.tools }

// SessionName returns the current session identifier.
func (a *Agent) SessionName() string { return a.sessionName }

// Model returns the current model name.
func (a *Agent) Model() string { return a.config.Model }

// TokenCount returns the current total token count.
func (a *Agent) TokenCount() int {
	a.mu.Lock()
	defer a.mu.Unlock()
	return a.totalTokens
}

// SetSession sets the session name.
func (a *Agent) SetSession(name string) {
	a.sessionName = name
}

// SetLogger updates the logger.
func (a *Agent) SetLogger(logger *slog.Logger) {
	a.logger = logger
}

// SetModel updates the model and recreates the LLM client.
func (a *Agent) SetModel(model, apiKey, baseURL string, contextLength int) {
	a.config.Model = model
	if apiKey != "" {
		a.config.APIKey = apiKey
	}
	if baseURL != "" {
		a.config.BaseURL = baseURL
	}
	if contextLength > 0 {
		a.config.ContextLength = contextLength
	}
	a.client = llm.NewClient(a.config.APIKey, a.config.BaseURL)
}

// --- Environment / System prompt ---

func (a *Agent) refreshEnvironment() {
	ctx := fmt.Sprintf("Working directory: %s\n", mustCwd())

	out, err := exec.Command("git", "status").CombinedOutput()
	if err == nil {
		ctx += "\n" + string(out) + "\n"
		ctx += "\nThis is the git status at the start of the conversation. Note that this status is a snapshot in time, and will not update during the conversation."
	}
	a.environmentContext = ctx
}

func (a *Agent) refreshSystemPrompt() {
	prompt := SystemPrompt
	if a.environmentContext != "" {
		prompt += "\n\n# Environment\n" + a.environmentContext
	}
	if a.config.UserPrompt != "" {
		prompt += "\n\n# Additional Instructions\n" + a.config.UserPrompt
	}
	if a.config.ProjectPromptFile != "" {
		prompt += fmt.Sprintf("\n\n# Workspace Information\nThis workspace's description is in `%s`. Use the Read tool to load it at the start of each conversation. It contains critical project instructions that you must follow.", a.config.ProjectPromptFile)
	}
	a.systemPrompt = prompt
}

func (a *Agent) SystemPrompt() string {
	return a.systemPrompt
}

// --- Session persistence ---

func (a *Agent) saveSession() {
	a.saveSessionLock.Lock()
	defer a.saveSessionLock.Unlock()
	_ = a.session.Save(a.sessionName, &session.Data{
		Model:       a.config.Model,
		Messages:    toAnySlice(a.store.ToLLMMessages()),
		TotalTokens: a.TokenCount(),
	})
}

// --- Run loop ---

// Run executes one user message through the agent loop.
// Returns true if the run started successfully.
func (a *Agent) Run(ctx context.Context, userMessage string) (bool, error) {
	a.mu.Lock()
	if a.isRunning {
		a.mu.Unlock()
		return false, nil
	}
	a.isRunning = true
	a.mu.Unlock()

	defer func() {
		a.mu.Lock()
		a.isRunning = false
		a.mu.Unlock()
	}()

	ctx, cancel := context.WithCancel(ctx)
	a.mu.Lock()
	a.cancelFunc = cancel
	a.mu.Unlock()
	defer cancel()

	a.store.AddUserMessage(userMessage, "")

	for {
		if err := ctx.Err(); err != nil {
			return true, err
		}

		// Build tool definitions for the LLM
		toolDefs := a.buildToolDefs()

		// Stream LLM response
		_, toolCalls, hasTools, err := a.handleStream(ctx, toolDefs)
		if err != nil {
			if errors.Is(err, context.Canceled) {
				return true, nil
			}
			return true, err
		}

		if err := ctx.Err(); err != nil {
			return true, nil
		}

		// Execute tools
		denied, err := a.executeTools(ctx, toolCalls)
		if err != nil {
			return true, err
		}

		if denied {
			a.store.AddStatus(messages.RoleError, "Tool execution was denied by user")
			break
		}

		if hasTools {
			a.saveSession()
		}

		if !hasTools {
			break
		}
	}

	a.saveSession()
	return true, nil
}

// Abort cancels the currently running LLM request.
func (a *Agent) Abort() {
	a.mu.Lock()
	defer a.mu.Unlock()
	if a.cancelFunc != nil {
		a.cancelFunc()
	}
}

// --- Private: streaming ---

type toolCall struct {
	Block llm.ContentBlock
	Tool  tools.Tool
}

func (a *Agent) handleStream(ctx context.Context, toolDefs []llm.Tool) (*llm.Message, []toolCall, bool, error) {
	llmMsgs := messagesToLLM(a.store.ToLLMMessages())
	ch, err := a.client.ChatStream(ctx, llmMsgs, toolDefs, llm.ChatOptions{
		Model:  a.config.Model,
		System: a.systemPrompt,
	})
	if err != nil {
		return nil, nil, false, err
	}

	var (
		totalUsage  *llm.Usage
		toolCalls   []toolCall
		hasToolCalls bool
	)

	for evt := range ch {
		if evt.Error != nil {
			return nil, nil, false, evt.Error
		}

		switch evt.Type {
		case "thinking":
			last := a.store.LastBlock()
			if last != nil && last.Type == "thinking" {
				a.store.UpdateLastBlock("", last.Thinking+evt.Delta)
			} else {
				a.store.AppendToLastAssistantTurn(messages.ContentBlock{
					Type:     "thinking",
					Thinking: evt.Delta,
				})
			}
		case "text":
			last := a.store.LastBlock()
			if last != nil && last.Type == "text" {
				a.store.UpdateLastBlock(last.Text+evt.Delta, "")
			} else {
				a.store.AppendToLastAssistantTurn(messages.ContentBlock{
					Type: "text",
					Text: evt.Delta,
				})
			}
		case "content_block_start":
			if evt.Block.Type == "tool_use" {
				hasToolCalls = true
				block := messages.ContentBlock{
					Type:  "tool_use",
					ID:    evt.Block.ID,
					Name:  evt.Block.Name,
					Input: evt.Block.Input,
				}
				a.store.AppendToLastAssistantTurn(block)
				if t, ok := a.tools.Get(evt.Block.Name); ok {
					toolCalls = append(toolCalls, toolCall{
						Block: evt.Block,
						Tool:  t,
					})
				}
			} else if evt.Block.Type == "text" {
				a.store.AppendToLastAssistantTurn(messages.ContentBlock{
					Type: "text",
					Text: evt.Block.Text,
				})
			} else if evt.Block.Type == "thinking" {
				a.store.AppendToLastAssistantTurn(messages.ContentBlock{
					Type:     "thinking",
					Thinking: evt.Block.Thinking,
				})
			}
		case "message_delta":
			if evt.Usage != nil {
				totalUsage = evt.Usage
			}
		}
	}

	if totalUsage != nil {
		a.processTokenUsage(totalUsage)
	}

	return nil, toolCalls, hasToolCalls, nil
}

func (a *Agent) buildToolDefs() []llm.Tool {
	all := a.tools.All()
	defs := make([]llm.Tool, 0, len(all))
	for _, t := range all {
		for _, ex := range a.config.ExcludeTools {
			if t.Name() == ex {
				goto skip
			}
		}
		defs = append(defs, llm.Tool{
			Name:        t.Name(),
			Description: t.Description(),
			InputSchema: t.InputSchema(),
		})
	skip:
	}
	return defs
}

// --- Private: tool execution ---

func (a *Agent) executeTools(ctx context.Context, calls []toolCall) (denied bool, err error) {
	if len(calls) == 0 {
		return false, nil
	}

	tc := tools.Context{
		Config: tools.AgentConfig{
			APIKey:        a.config.APIKey,
			BaseURL:       a.config.BaseURL,
			Model:         a.config.Model,
			ContextLength: a.config.ContextLength,
		},
		CurrentAgentID: "1",
	}

	var results []messages.ToolResult
	for _, call := range calls {
		args := call.Block.Input
		if args == nil {
			args = map[string]any{}
		}

		result, execErr := call.Tool.Execute(ctx, args, tc)
		if execErr != nil {
			var deniedErr *tools.ToolDeniedError
			if errors.As(execErr, &deniedErr) {
				results = append(results, messages.ToolResult{
					ToolUseID: call.Block.ID,
					Content:   deniedErr.Reason,
				})
				// Reject remaining tools in this batch
				for _, remaining := range calls[len(results):] {
					results = append(results, messages.ToolResult{
						ToolUseID: remaining.Block.ID,
						Content:   deniedErr.Reason,
					})
				}
				a.store.AddToolResults(results)
				return true, nil
			}
			results = append(results, messages.ToolResult{
				ToolUseID: call.Block.ID,
				Content:   fmt.Sprintf("Error: %s", execErr.Error()),
			})
			continue
		}
		results = append(results, messages.ToolResult{
			ToolUseID: call.Block.ID,
			Content:   result.Output,
		})
	}

	a.store.AddToolResults(results)
	return false, nil
}

// --- Private: token tracking ---

func (a *Agent) processTokenUsage(usage *llm.Usage) {
	a.mu.Lock()
	input := usage.InputTokens + usage.CacheCreationInputTokens + usage.CacheReadInputTokens
	output := usage.OutputTokens
	a.totalTokens += input + output
	total := a.totalTokens
	lastThreshold := a.threshold
	a.mu.Unlock()

	if a.onTokenUpdate != nil {
		a.onTokenUpdate(total)
	}

	ratio := float64(total) / float64(a.config.ContextLength)
	pct := int(ratio * 100)

	for _, t := range []int{25, 50, 75, 90} {
		if pct >= t && lastThreshold < t {
			a.store.AddStatus(messages.RoleStatus, fmt.Sprintf("[%d%% context]", pct))
			a.mu.Lock()
			a.threshold = t
			a.mu.Unlock()
			break
		}
	}

	if ratio >= a.config.CompressionThresholdRatio {
		go func() {
			_ = a.compress(context.Background())
		}()
	}
}

// --- Compression ---

func (a *Agent) compress(ctx context.Context) error {
	a.mu.Lock()
	if a.isCompressing {
		a.mu.Unlock()
		return nil
	}
	a.isCompressing = true
	a.mu.Unlock()

	defer func() {
		a.mu.Lock()
		a.isCompressing = false
		a.mu.Unlock()
	}()

	turns := a.store.GetTurns()
	const keepRecent = 10
	if len(turns) <= keepRecent+2 {
		a.store.AddStatus(messages.RoleStatus, "(Not enough messages to compress)")
		return nil
	}

	totalTokens := a.TokenCount()
	a.store.AddStatus(messages.RoleStatus,
		fmt.Sprintf("(Compressing %d messages, %d tokens...)", len(turns)-keepRecent, totalTokens))

	compressed, err := a.compressMessages(ctx, turns)
	if err != nil {
		a.store.AddStatus(messages.RoleError,
			fmt.Sprintf("(Compression failed: %s)", err.Error()))
		return err
	}

	a.store.Replace(compressed)
	a.mu.Lock()
	a.totalTokens = 0
	a.mu.Unlock()

	if a.onTokenUpdate != nil {
		a.onTokenUpdate(0)
	}

	a.store.AddStatus(messages.RoleStatus,
		fmt.Sprintf("(Compressed to %d turns)", len(compressed)))
	return nil
}

func (a *Agent) compressMessages(ctx context.Context, turns []messages.MessageParam) ([]messages.MessageParam, error) {
	// Stub: for now, just keep recent messages.
	// A full implementation would call the LLM to summarise old turns.
	const keepRecent = 10
	if len(turns) <= keepRecent {
		return turns, nil
	}
	recent := make([]messages.MessageParam, keepRecent)
	copy(recent, turns[len(turns)-keepRecent:])

	summary := messages.MessageParam{
		Role:    "user",
		Content: fmt.Sprintf("[Compressed %d earlier messages]", len(turns)-keepRecent),
	}
	// Insert summary before the recent turns
	result := []messages.MessageParam{summary}
	result = append(result, recent...)
	return result, nil
}

// --- Lifecycle ---

// ClearSession resets the conversation.
func (a *Agent) ClearSession() {
	a.store.Clear()
	a.mu.Lock()
	a.totalTokens = 0
	a.threshold = 0
	a.mu.Unlock()
	if a.onTokenUpdate != nil {
		a.onTokenUpdate(0)
	}
}

// LoadSession restores saved messages into the agent.
func (a *Agent) LoadSession(name string) error {
	data, err := a.session.Get(name)
	if err != nil {
		return err
	}
	a.sessionName = name
	// Convert []any to []messages.MessageParam
	var turns []messages.MessageParam
	for _, raw := range data.Messages {
		if m, ok := raw.(map[string]any); ok {
			mp := messages.MessageParam{}
			if r, ok := m["role"].(string); ok {
				mp.Role = r
			}
			mp.Content = m["content"]
			if d, ok := m["_display"].(string); ok {
				mp.Display = d
			}
			turns = append(turns, mp)
		}
	}
	a.store.SetTurns(turns)
	a.mu.Lock()
	a.totalTokens = data.TotalTokens
	a.threshold = 0
	a.mu.Unlock()
	if a.onTokenUpdate != nil {
		a.onTokenUpdate(data.TotalTokens)
	}
	return nil
}

// --- Helpers ---

func mustCwd() string {
	cwd, err := os.Getwd()
	if err != nil {
		return "unknown"
	}
	return cwd
}

func toAnySlice(messages []messages.MessageParam) []any {
	result := make([]any, len(messages))
	for i, m := range messages {
		result[i] = m
	}
	return result
}

func messagesToLLM(msgs []messages.MessageParam) []llm.MessageParam {
	result := make([]llm.MessageParam, len(msgs))
	for i, m := range msgs {
		result[i] = llm.MessageParam{Role: m.Role, Content: m.Content}
	}
	return result
}
