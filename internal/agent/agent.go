package agent

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

	"minicode/internal/domain"
	"minicode/internal/llm"
	"minicode/internal/skills"
	"minicode/internal/storage"
	"minicode/internal/tools"
)

// Agent orchestrates the conversation loop.
type Agent struct {
	client    llm.Client
	config    domain.AgentConfig
	store     *Store
	tools     *tools.ToolRegistry
	session   *storage.SessionManager
	skills    *skills.SkillRegistry
	permSvc   tools.PermissionChecker
	askUserFn func(question string, options []domain.AskOption, multiSelect bool) string
	registry  *AgentRegistry
	id        string

	sessionName string
	logger      *slog.Logger
	tokenMgr    *TokenManager

	mu            sync.Mutex
	cancelFunc    context.CancelFunc
	isRunning     bool
	isCompressing bool

	// Callbacks
	onTokenUpdate  func(total int)
	onStatusUpdate func(role, content string)

	// Command resolver (slash commands like /plan, /clear)
	resolveCommand func(input string) (handled bool, promptText string, displayContent string)

	environmentContext string
	systemPrompt       string
}

// NewAgent creates a new Agent.
func NewAgent(cfg domain.AgentConfig) *Agent {
	if cfg.ContextLength == 0 {
		cfg.ContextLength = 200000
	}

	a := &Agent{
		client:      llm.NewClient(cfg.APIKey, cfg.BaseURL),
		config:      cfg,
		store:       NewStore(),
		tools:       tools.NewToolRegistry(),
		session:     storage.NewSessionManager(),
		tokenMgr:    NewTokenManager(),
		logger:      slog.New(slog.NewTextHandler(os.Stderr, nil)),
		sessionName: fmt.Sprintf("session-%d", time.Now().UnixMilli()),
		id:          "1",
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
func (a *Agent) ToolRegistry() *tools.ToolRegistry { return a.tools }

// SetSkills sets the skill registry for tool context.
func (a *Agent) SetSkills(sr *skills.SkillRegistry) { a.skills = sr; a.refreshSystemPrompt() }

// Skills returns the skill registry.
func (a *Agent) Skills() *skills.SkillRegistry { return a.skills }

// Compress triggers conversation compression (public wrapper).
func (a *Agent) Compress() { go a.compress(context.Background()) }

// SetCommandResolver sets the slash command resolver.
func (a *Agent) SetCommandResolver(fn func(input string) (handled bool, promptText string, displayContent string)) {
	a.resolveCommand = fn
}

// PermissionSvc returns the current permission service.
func (a *Agent) PermissionSvc() tools.PermissionChecker { return a.permSvc }

// SetPermissionSvc sets the permission service.
func (a *Agent) SetPermissionSvc(p tools.PermissionChecker) { a.permSvc = p }

// ID returns the agent identifier.
func (a *Agent) ID() string { return a.id }

// SetID sets the agent identifier.
func (a *Agent) SetID(id string) { a.id = id }

// SetRegistry sets the agent registry.
func (a *Agent) SetRegistry(r *AgentRegistry) { a.registry = r }

// SetAskUserFn sets the callback for the AskUser tool.
func (a *Agent) SetAskUserFn(fn func(question string, options []domain.AskOption, multiSelect bool) string) {
	a.askUserFn = fn
}

// ContextLength returns the configured context length.
func (a *Agent) ContextLength() int { return a.config.ContextLength }

// SessionName returns the current session identifier.
func (a *Agent) SessionName() string { return a.sessionName }

// Model returns the current model name.
func (a *Agent) Model() string { return a.config.Model }

// TokenCount returns the current total token count.
func (a *Agent) TokenCount() int {
	return a.tokenMgr.Total()
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
	a.client = llm.NewClient(a.config.APIKey, a.config.BaseURL)
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
	prompt := domain.SystemPrompt
	if a.environmentContext != "" {
		prompt += "\n\n# Environment\n" + a.environmentContext
	}
	if a.config.UserPrompt != "" {
		prompt += "\n\n# Additional Instructions\n" + a.config.UserPrompt
	}
	if a.config.ProjectPromptFile != "" {
		prompt += fmt.Sprintf("\n\n# Workspace Information\nThis workspace's description is in `%s`. Use the Read tool to load it at the start of each conversation. It contains critical project instructions that you must follow.", a.config.ProjectPromptFile)
	}

	// Inject available skills
	if a.skills != nil {
		available := a.skills.List()
		if len(available) > 0 {
			prompt += "\n\n<available_skills>\n"
			for _, sk := range available {
				prompt += fmt.Sprintf("  <skill>\n    <name>%s</name>\n    <description>%s</description>\n  </skill>\n", sk.Name, sk.Description)
			}
			prompt += "</available_skills>\n"
			prompt += "\nTo activate a skill and receive its detailed instructions, use the ActivateSkill tool with the skill's name.\n"
		}
	}

	a.systemPrompt = prompt
}

// SystemPrompt returns the current system prompt.
func (a *Agent) SystemPrompt() string { return a.systemPrompt }

func (a *Agent) saveSession() {
	_ = a.session.Save(a.sessionName, &storage.SessionData{
		Model:       a.config.Model,
		Messages:    a.store.ToLLMMessages(),
		TotalTokens: a.tokenMgr.Total(),
	})
}

// Run executes one user message through the agent loop.
func (a *Agent) Run(ctx context.Context, userMessage, displayContent string) (bool, error) {
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

	a.store.SetStreaming(true)
	defer a.store.SetStreaming(false)

	ctx, cancel := context.WithCancel(ctx)
	a.mu.Lock()
	a.cancelFunc = cancel
	a.mu.Unlock()
	defer cancel()

	// Resolve slash commands
	llmText := userMessage
	display := displayContent
	if a.resolveCommand != nil {
		handled, expanded, disp := a.resolveCommand(userMessage)
		if handled {
			if expanded != "" {
				llmText = expanded
				display = disp
			} else {
				// Handler command executed (e.g. /clear) — nothing to send to LLM
				return false, nil
			}
		}
	}

	a.store.AddUserMessage(llmText, display)

	runErr := (error)(nil)
	for {
		if err := ctx.Err(); err != nil {
			runErr = err
			break
		}

		toolDefs := a.buildLLMTools()
		toolCalls, hasTools, err := a.handleStream(ctx, toolDefs)
		if err != nil {
			if errors.Is(err, context.Canceled) {
				runErr = err
				break
			}
			return true, err
		}

		if err := ctx.Err(); err != nil {
			runErr = err
			break
		}

		denied, err := a.executeTools(ctx, toolCalls)
		if err != nil {
			return true, err
		}
		if denied {
			break
		}

		// Trigger compression if over threshold
		if a.tokenMgr.ShouldCompress(a.config.ContextLength, a.config.CompressionThresholdRatio) {
			go a.compress(ctx)
		}

		if hasTools {
			a.saveSession()
		}
		if !hasTools {
			break
		}
	}

	if runErr != nil && (errors.Is(runErr, context.Canceled) || runErr.Error() == "context canceled") {
		// Cleanup: remove the last user message that triggered this aborted run
		a.store.Pop()
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
	a.tokenMgr.Reset()
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
	a.store.SetTurns(data.Messages)
	a.tokenMgr.Reset()
	a.tokenMgr.Add(data.TotalTokens, 0, 0, 0)
	if a.onTokenUpdate != nil {
		a.onTokenUpdate(a.tokenMgr.Total())
	}
	return nil
}

// ---- Private ----

type toolCall struct {
	Block domain.ContentBlock
	Tool  tools.Tool
}

func (a *Agent) handleStream(ctx context.Context, toolDefs []llm.Tool) ([]toolCall, bool, error) {
	a.store.StartAssistantTurn()

	ch, err := a.client.ChatStream(ctx, a.store.ToLLMMessages(), toolDefs, llm.ChatOptions{
		Model:           a.config.Model,
		System:          a.systemPrompt,
		ThinkingEnabled: a.config.ThinkingEnabled,
		ThinkingBudget:  int64(a.config.ThinkingBudget),
	})
	if err != nil {
		return nil, false, err
	}

	var toolCalls []toolCall
	var hasToolCalls bool
	var totalUsage *domain.Usage

	// Track tool_use blocks by index for input JSON accumulation
	type pendingTool struct {
		block   domain.ContentBlock
		tool    tools.Tool
		jsonBuf strings.Builder
	}
	pendingTools := make(map[int]*pendingTool)

	for evt := range ch {
		if evt.Error != nil {
			return nil, false, evt.Error
		}

		switch evt.Type {
		case "thinking":
			last := a.store.LastBlock()
			if last != nil && last.Type == "thinking" {
				a.store.UpdateLastBlock("", last.Thinking+evt.Delta)
			} else {
				a.store.AppendToLastAssistantTurn(domain.ContentBlock{Type: "thinking", Thinking: evt.Delta})
			}
		case "text":
			last := a.store.LastBlock()
			if last != nil && last.Type == "text" {
				a.store.UpdateLastBlock(last.Text+evt.Delta, "")
			} else {
				a.store.AppendToLastAssistantTurn(domain.ContentBlock{Type: "text", Text: evt.Delta})
			}
		case "content_block_start":
			switch evt.Block.Type {
			case "tool_use":
				hasToolCalls = true
				pt := &pendingTool{
					block: domain.ContentBlock{
						Type: "tool_use",
						ID:   evt.Block.ID,
						Name: evt.Block.Name,
					},
				}
				if t, ok := a.tools.Get(evt.Block.Name); ok {
					pt.tool = t
					toolCalls = append(toolCalls, toolCall{Block: pt.block, Tool: t})
				}
				pendingTools[evt.Index] = pt
			case "text":
				a.store.AppendToLastAssistantTurn(domain.ContentBlock{Type: "text", Text: evt.Block.Text})
			case "thinking":
				a.store.AppendToLastAssistantTurn(domain.ContentBlock{Type: "thinking", Thinking: evt.Block.Thinking})
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
				a.saveSession()
			} else {
				a.saveSession()
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

	return toolCalls, hasToolCalls, nil
}

func (a *Agent) buildLLMTools() []llm.Tool {
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

func (a *Agent) executeTools(ctx context.Context, calls []toolCall) (denied bool, err error) {
	if len(calls) == 0 {
		return false, nil
	}

	tc := tools.ToolContext{
		Config:         a.config,
		PermissionSvc:  a.permSvc,
		AskUserFn:      a.askUserFn,
		CurrentAgentID: a.id,
		ParentRegistry: a.tools,
		AgentRegistry:  a.registry,
		AgentFactory:   &agentFactory{registry: a.registry},
		Skills:         a.skills,
		SetModelFn:     a.SetModel,
	}

	var results []toolResultItem
	for i, call := range calls {
		args, _ := call.Block.Input.(map[string]any)
		if args == nil {
			args = map[string]any{}
		}

		// Permission Check
		if call.Tool.RequiresPermission() && tc.PermissionSvc != nil {
			displayText := fmt.Sprintf("%s(%v)", call.Tool.Name(), args)
			allowed, reason := tc.PermissionSvc.Check(call.Tool.Name(), displayText, args)
			if !allowed {
				if tc.PermissionSvc.Mode() == domain.PermAuto {
					results = append(results, toolResultItem{
						ToolUseID: call.Block.ID,
						Content:   fmt.Sprintf("Tool execution denied by auto-gate: %s", reason),
					})
					continue
				}

				// Manual denial: stop execution and report
				results = append(results, toolResultItem{ToolUseID: call.Block.ID, Content: reason})
				for j := i + 1; j < len(calls); j++ {
					results = append(results, toolResultItem{ToolUseID: calls[j].Block.ID, Content: reason})
				}
				a.store.AddToolResults(results)
				a.store.AddStatus(domain.RoleError, fmt.Sprintf("Tool %q was denied by user", call.Tool.Name()))
				return true, nil
			}
		}

		result, execErr := call.Tool.Execute(ctx, args, tc)
		if execErr != nil {
			results = append(results, toolResultItem{ToolUseID: call.Block.ID, Content: fmt.Sprintf("Error: %s", execErr.Error())})
			continue
		}
		results = append(results, toolResultItem{ToolUseID: call.Block.ID, Content: result.Output})
	}

	a.store.AddToolResults(results)
	return false, nil
}

func (a *Agent) processTokenUsage(usage *domain.Usage) {
	a.tokenMgr.Add(usage.InputTokens, usage.OutputTokens, usage.CacheCreationInputTokens, usage.CacheReadInputTokens)
	total := a.tokenMgr.Total()
	lastThreshold := a.tokenMgr.LastShownThreshold()

	if a.onTokenUpdate != nil {
		a.onTokenUpdate(total)
	}

	ratio := a.tokenMgr.Ratio(a.config.ContextLength)
	pct := int(ratio * 100)

	for _, t := range []int{25, 50, 75, 90} {
		if pct >= t && lastThreshold < t {
			a.store.AddStatus(domain.RoleStatus, fmt.Sprintf("[%d%% context]", pct))
			a.tokenMgr.SetLastShownThreshold(t)
			break
		}
	}
}

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

	turns := a.store.Turns()
	const keepRecent = 10
	if len(turns) <= keepRecent+2 {
		a.store.AddStatus(domain.RoleStatus, "(Not enough messages to compress)")
		return nil
	}

	a.store.AddStatus(domain.RoleStatus,
		fmt.Sprintf("(Compressing %d messages, %d tokens...)", len(turns)-keepRecent, a.tokenMgr.Total()))

	// Keep most recent turns intact; insert summary of older ones
	recent := make([]domain.MessageParam, keepRecent)
	copy(recent, turns[len(turns)-keepRecent:])
	summary := domain.MessageParam{
		Role:    "user",
		Content: fmt.Sprintf("[Compressed %d earlier messages]", len(turns)-keepRecent),
	}
	compressed := []domain.MessageParam{summary}
	compressed = append(compressed, recent...)

	a.store.Replace(compressed)
	a.tokenMgr.Reset()

	if a.onTokenUpdate != nil {
		a.onTokenUpdate(0)
	}
	a.store.AddStatus(domain.RoleStatus, fmt.Sprintf("(Compressed to %d turns)", len(compressed)))
	return nil
}

func mustCwd() string {
	if cwd, err := os.Getwd(); err == nil {
		return cwd
	}
	return "unknown"
}

// agentFactory implements tools.AgentFactory to avoid circular imports.
type agentFactory struct {
	registry *AgentRegistry
}

func (f *agentFactory) Create(cfg domain.AgentConfig) any {
	ag := NewAgent(cfg)
	ag.SetRegistry(f.registry)
	return ag
}

func (f *agentFactory) Run(ag any, ctx context.Context, task string) error {
	agent := ag.(*Agent)
	_, err := agent.Run(ctx, task, "")
	return err
}

func (f *agentFactory) GetTurns(ag any) []domain.MessageParam {
	agent := ag.(*Agent)
	return agent.store.Turns()
}
