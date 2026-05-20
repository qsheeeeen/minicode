package internal

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"os"
	"os/exec"
	"strings"
	"sync"
	"time"
)

// SystemPrompt is the base system prompt.
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

// Agent orchestrates the conversation loop.
type Agent struct {
	client    *Client
	config    AgentConfig
	store     *Store
	tools     *ToolRegistry
	session   *SessionManager

	sessionName string
	logger      *slog.Logger
	totalTokens int
	threshold   int

	mu            sync.Mutex
	cancelFunc    context.CancelFunc
	isRunning     bool
	isCompressing bool

	// Callbacks
	onTokenUpdate  func(total int)
	onStatusUpdate func(role, content string)

	environmentContext string
	systemPrompt       string
}

// NewAgent creates a new Agent.
func NewAgent(cfg AgentConfig) *Agent {
	if cfg.ContextLength == 0 {
		cfg.ContextLength = 200000
	}

	a := &Agent{
		client:      NewClient(cfg.APIKey, cfg.BaseURL),
		config:      cfg,
		store:       NewStore(),
		tools:       NewToolRegistry(),
		session:     NewSessionManager(),
		logger:      slog.New(slog.NewTextHandler(os.Stderr, nil)),
		sessionName: fmt.Sprintf("session-%d", time.Now().UnixMilli()),
	}

	a.refreshEnvironment()
	a.refreshSystemPrompt()
	return a
}

// OnTokenUpdate registers a callback for token count changes.
func (a *Agent) OnTokenUpdate(fn func(total int)) { a.onTokenUpdate = fn }

// OnDisplayChange registers a callback for message store changes.
func (a *Agent) OnDisplayChange(fn func()) { a.store.OnChange(fn) }

// Store returns the message store.
func (a *Agent) Store() *Store { return a.store }

// ToolRegistry returns the tool registry.
func (a *Agent) ToolRegistry() *ToolRegistry { return a.tools }

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
func (a *Agent) SetSession(name string) { a.sessionName = name }

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
	a.client = NewClient(a.config.APIKey, a.config.BaseURL)
}

func (a *Agent) refreshEnvironment() {
	ctx := fmt.Sprintf("Working directory: %s\n", mustCwd())
	out, err := exec.Command("git", "status").CombinedOutput()
	if err == nil {
		ctx += "\n" + string(out) + "\n"
		ctx += "\nThis is the git status at the start of the conversation."
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
		prompt += fmt.Sprintf("\n\n# Workspace Information\nThis workspace's description is in `%s`.", a.config.ProjectPromptFile)
	}
	a.systemPrompt = prompt
}

// SystemPrompt returns the current system prompt.
func (a *Agent) SystemPrompt() string { return a.systemPrompt }

func (a *Agent) saveSession() {
	_ = a.session.Save(a.sessionName, &SessionData{
		Model:       a.config.Model,
		Messages:    toAnySlice(a.store.ToLLMMessages()),
		TotalTokens: a.TokenCount(),
	})
}

// Run executes one user message through the agent loop.
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

		toolDefs := a.buildLLMTools()
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

		denied, err := a.executeTools(ctx, toolCalls)
		if err != nil {
			return true, err
		}
		if denied {
			a.store.AddStatus(RoleError, "Tool execution was denied by user")
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
	var turns []MessageParam
	for _, raw := range data.Messages {
		if m, ok := raw.(map[string]any); ok {
			mp := MessageParam{}
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

// ---- Private ----

type toolCall struct {
	Block ContentBlock
	Tool  Tool
}

func (a *Agent) handleStream(ctx context.Context, toolDefs []LLMTool) (*LLMMessage, []toolCall, bool, error) {
	ch, err := a.client.ChatStream(ctx, a.store.ToLLMMessages(), toolDefs, ChatOptions{
		Model:  a.config.Model,
		System: a.systemPrompt,
	})
	if err != nil {
		return nil, nil, false, err
	}

	var toolCalls []toolCall
	var hasToolCalls bool
	var totalUsage *LLMUsage

	// Track tool_use blocks by index for input JSON accumulation
	type pendingTool struct {
		block  ContentBlock
		tool   Tool
		jsonBuf strings.Builder
	}
	pendingTools := make(map[int]*pendingTool)

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
				a.store.AppendToLastAssistantTurn(ContentBlock{Type: "thinking", Thinking: evt.Delta})
			}
		case "text":
			last := a.store.LastBlock()
			if last != nil && last.Type == "text" {
				a.store.UpdateLastBlock(last.Text+evt.Delta, "")
			} else {
				a.store.AppendToLastAssistantTurn(ContentBlock{Type: "text", Text: evt.Delta})
			}
		case "content_block_start":
			switch evt.Block.Type {
			case "tool_use":
				hasToolCalls = true
				if t, ok := a.tools.Get(evt.Block.Name); ok {
					pt := &pendingTool{
						block: ContentBlock{
							Type: "tool_use",
							ID:   evt.Block.ID,
							Name: evt.Block.Name,
						},
						tool: t,
					}
					pendingTools[evt.Index] = pt
					toolCalls = append(toolCalls, toolCall{Block: pt.block, Tool: t})
				}
			case "text":
				a.store.AppendToLastAssistantTurn(ContentBlock{Type: "text", Text: evt.Block.Text})
			case "thinking":
				a.store.AppendToLastAssistantTurn(ContentBlock{Type: "thinking", Thinking: evt.Block.Thinking})
			}
		case "input_json_delta":
			if pt, ok := pendingTools[evt.Index]; ok {
				pt.jsonBuf.WriteString(evt.Delta)
			}
		case "content_block_stop":
			if pt, ok := pendingTools[evt.Index]; ok {
				// Parse accumulated JSON as input
				if pt.jsonBuf.Len() > 0 {
					var input map[string]any
					if err := json.Unmarshal([]byte(pt.jsonBuf.String()), &input); err == nil {
						pt.block.Input = input
					}
				}
				if pt.block.Input == nil {
					pt.block.Input = map[string]any{}
				}
				// Update the toolCall with the completed block
				for i := range toolCalls {
					if toolCalls[i].Block.ID == pt.block.ID {
						toolCalls[i].Block = pt.block
						break
					}
				}
				// Append to store
				a.store.AppendToLastAssistantTurn(pt.block)
				delete(pendingTools, evt.Index)
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

func (a *Agent) buildLLMTools() []LLMTool {
	all := a.tools.All()
	defs := make([]LLMTool, 0, len(all))
	for _, t := range all {
		for _, ex := range a.config.ExcludeTools {
			if t.Name() == ex {
				goto skip
			}
		}
		defs = append(defs, LLMTool{
			Name:        t.Name(),
			Description: t.Description(),
			InputSchema: t.InputSchema(),
		})
	skip:
	}
	return defs
}

func (a *Agent) executeTools(ctx context.Context, calls []toolCall) (denied bool, err error) {
	if len(calls) == 0 {
		return false, nil
	}

	tc := ToolContext{
		Config:         a.config,
		CurrentAgentID: "1",
	}

	var results []ToolResultMsg
	for _, call := range calls {
		args, _ := call.Block.Input.(map[string]any)
		if args == nil {
			args = map[string]any{}
		}

		result, execErr := call.Tool.Execute(ctx, args, tc)
		if execErr != nil {
			var deniedErr *ToolDeniedError
			if errors.As(execErr, &deniedErr) {
				results = append(results, ToolResultMsg{ToolUseID: call.Block.ID, Content: deniedErr.Reason})
				for _, remaining := range calls[len(results):] {
					results = append(results, ToolResultMsg{ToolUseID: remaining.Block.ID, Content: deniedErr.Reason})
				}
				a.store.AddToolResults(results)
				return true, nil
			}
			results = append(results, ToolResultMsg{ToolUseID: call.Block.ID, Content: fmt.Sprintf("Error: %s", execErr.Error())})
			continue
		}
		results = append(results, ToolResultMsg{ToolUseID: call.Block.ID, Content: result.Output})
	}

	a.store.AddToolResults(results)
	return false, nil
}

func (a *Agent) processTokenUsage(usage *LLMUsage) {
	a.mu.Lock()
	input := usage.InputTokens + usage.CacheCreationInputTokens + usage.CacheReadInputTokens
	a.totalTokens += input + usage.OutputTokens
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
			a.store.AddStatus(RoleStatus, fmt.Sprintf("[%d%% context]", pct))
			a.mu.Lock()
			a.threshold = t
			a.mu.Unlock()
			break
		}
	}
}

func mustCwd() string {
	if cwd, err := os.Getwd(); err == nil {
		return cwd
	}
	return "unknown"
}

func toAnySlice(messages []MessageParam) []any {
	result := make([]any, len(messages))
	for i, m := range messages {
		result[i] = m
	}
	return result
}
