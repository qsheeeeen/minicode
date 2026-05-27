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

	"minicode/internal/log"

	"minicode/internal/domain"
	"minicode/internal/llm"
	"minicode/internal/services"
	"minicode/internal/skills"
	"minicode/internal/storage"
	"minicode/internal/tools"
)

// Agent orchestrates the conversation loop.
type Agent struct {
	client    llm.Client
	config    domain.AgentConfig
	store     *Store
	session   *storage.SessionManager
	permSvc   services.PermissionChecker
	askUserFn func(question string, options []domain.AskOption, multiSelect bool) string
	id        string

	sessionName string
	tokenMgr    *services.TokenManager
	toolList    []tools.Tool // allowed tools for this agent

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

	projectHash := log.ProjectHash()
	sessName := fmt.Sprintf("session-%d", time.Now().UnixMilli())
	log.Set(projectHash, sessName)
	a := &Agent{
		client:      llm.NewClient(cfg.APIKey, cfg.BaseURL),
		config:      cfg,
		store:       NewStore(),
		session:     storage.NewSessionManager(),
		tokenMgr:    services.NewTokenManager(),
		sessionName: sessName,
		id:          "1",
		toolList:    tools.All(),
	}

	// Register the only tool that needs AgentConfig
	tools.Register(tools.NewSubAgentTool(cfg))

	// Load skills from .agent/ directory
	skills.LoadSkills(".agent")
	a.refreshSystemPrompt()

	// Permission service
	a.permSvc = services.NewPermissionService(cfg.PermissionMode)

	a.refreshEnvironment()
	a.refreshSystemPrompt()
	log.Get().Info("agent created", "session", a.sessionName, "model", a.config.Model, "provider", a.config.Provider)
	return a
}

// Logger returns the global logger.
func (a *Agent) Logger() *slog.Logger { return log.Get() }

// OnTokenUpdate registers a callback for token count changes.
func (a *Agent) OnTokenUpdate(fn func(total int)) { a.onTokenUpdate = fn }

// OnDisplayChange registers a callback for message store changes.
func (a *Agent) OnDisplayChange(fn func()) { a.store.OnChange(fn) }

// Store returns the message store.
func (a *Agent) Store() *Store { return a.store }

// Compress triggers conversation compression (public wrapper).
func (a *Agent) Compress() { go a.compress(context.Background()) }

// SetCommandResolver sets the slash command resolver.
func (a *Agent) SetCommandResolver(fn func(input string) (handled bool, promptText string, displayContent string)) {
	a.resolveCommand = fn
}

// PermissionSvc returns the current permission service.
func (a *Agent) PermissionSvc() services.PermissionChecker { return a.permSvc }

// SetPermissionSvc sets the permission service.
func (a *Agent) SetPermissionSvc(p services.PermissionChecker) { a.permSvc = p }

// ID returns the agent identifier.
func (a *Agent) ID() string { return a.id }

// SetID sets the agent identifier.
func (a *Agent) SetID(id string) { a.id = id }

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

// Provider returns the current LLM provider name.
func (a *Agent) Provider() string { return a.config.Provider }

// SetEffort updates the thinking effort level.
func (a *Agent) SetEffort(effort string) { a.config.Effort = effort }

// TokenCount returns the current total token count.
func (a *Agent) TokenCount() int {
	return a.tokenMgr.Total()
}

// SetSession sets the session name and swaps the global logger to a new session log file.
func (a *Agent) SetSession(name string) {
	a.sessionName = name
	log.Set(log.ProjectHash(), name)
}

// SetModel updates the model and recreates the LLM client.
func (a *Agent) SetModel(modelSpec, apiKey, baseURL string, contextLength int) {
	oldModel := a.config.Model
	oldProvider := a.config.Provider
	// Parse model@provider format
	if idx := strings.Index(modelSpec, "@"); idx >= 0 {
		a.config.Model = modelSpec[:idx]
		a.config.Provider = modelSpec[idx+1:]
	} else {
		a.config.Model = modelSpec
	}
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
	log.Get().Info("model updated", "session", a.sessionName, "old_model", oldModel, "old_provider", oldProvider, "new_model", a.config.Model, "new_provider", a.config.Provider)
}

func (a *Agent) refreshEnvironment() {
	ctx := fmt.Sprintf("Working directory: %s\n", getCwd())
	out, err := exec.Command("git", "status").CombinedOutput()
	if err == nil {
		ctx += "\n" + string(out) + "\n"
		ctx += "\nThis is the git status at the start of the conversation. Note that this status is a snapshot in time, and will not update during the conversation."
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
	prompt += "\n\n# Workspace Information\nThis workspace's description is in `AGENTS.md`. Use the Read tool to load it at the start of each conversation. It contains critical project instructions that you must follow."

	// Inject available skills
	available := skills.List()
	if len(available) > 0 {
		prompt += "\n\n<available_skills>\n"
		for _, sk := range available {
			prompt += fmt.Sprintf("  <skill>\n    <name>%s</name>\n    <description>%s</description>\n  </skill>\n", sk.Name, sk.Description)
		}
		prompt += "</available_skills>\n"
		prompt += "\nTo activate a skill and receive its detailed instructions, use the ActivateSkill tool with the skill's name.\n"
	}

	a.systemPrompt = prompt
}

// SystemPrompt returns the current system prompt.
func (a *Agent) SystemPrompt() string { return a.systemPrompt }

func (a *Agent) saveSession() {
	turns := a.store.ToLLMMessages()
	err := a.session.Save(a.sessionName, &storage.SessionData{
		Model:       a.config.Model,
		Messages:    turns,
		TotalTokens: a.tokenMgr.Total(),
	})
	if err != nil {
		log.Get().Error("save session failed", "session", a.sessionName, "error", err)
	} else {
		log.Get().Info("session saved", "session", a.sessionName, "turns", len(turns), "tokens", a.tokenMgr.Total())
	}
}

// Run executes one user message through the agent loop.
func (a *Agent) Run(ctx context.Context, userMessage, displayContent string) (bool, error) {
	a.mu.Lock()
	if a.isRunning {
		a.mu.Unlock()
		log.Get().Info("run rejected: already running", "session", a.sessionName)
		return false, nil
	}
	a.isRunning = true
	a.mu.Unlock()
	log.Get().Info("run started", "session", a.sessionName, "message_length", len(userMessage))

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
				log.Get().Info("command expanded", "original", userMessage, "expanded", expanded)
				llmText = expanded
				display = disp
			} else {
				// Handler command executed (e.g. /clear) — nothing to send to LLM
				log.Get().Info("command handled without LLM", "command", userMessage)
				return false, nil
			}
		}
	}

	a.store.AddUserMessage(llmText, display)

	runErr := (error)(nil)
	loopCount := 0
	for {
		loopCount++
		if err := ctx.Err(); err != nil {
			log.Get().Info("run cancelled by context", "session", a.sessionName, "loop", loopCount, "error", err)
			runErr = err
			break
		}

		toolDefs := a.buildLLMTools()
		log.Get().Info("sending to LLM", "session", a.sessionName, "loop", loopCount, "turns", len(a.store.Turns()), "tools", len(toolDefs))
		toolCalls, hasTools, err := a.handleStream(ctx, toolDefs)
		if err != nil {
			if errors.Is(err, context.Canceled) {
				log.Get().Info("run cancelled during stream", "session", a.sessionName, "loop", loopCount)
				runErr = err
				break
			}
			log.Get().Error("stream failed", "session", a.sessionName, "loop", loopCount, "error", err)
			return true, err
		}

		if err := ctx.Err(); err != nil {
			log.Get().Info("run cancelled after stream", "session", a.sessionName, "loop", loopCount, "error", err)
			runErr = err
			break
		}

		if len(toolCalls) > 0 {
			log.Get().Info("executing tools", "session", a.sessionName, "loop", loopCount, "count", len(toolCalls))
		}
		denied, err := a.executeTools(ctx, toolCalls)
		if err != nil {
			log.Get().Error("tool execution failed", "session", a.sessionName, "loop", loopCount, "error", err)
			return true, err
		}
		if denied {
			log.Get().Info("tool execution denied", "session", a.sessionName, "loop", loopCount)
			break
		}

		// Trigger compression if over threshold
		if a.tokenMgr.ShouldCompress(a.config.ContextLength, a.config.CompressionThresholdRatio) {
			log.Get().Info("compression triggered", "session", a.sessionName, "tokens", a.tokenMgr.Total(), "threshold", a.config.CompressionThresholdRatio)
			go a.compress(ctx)
		}

		if hasTools {
			a.saveSession()
		}
		if !hasTools {
			log.Get().Info("no tool calls, ending loop", "session", a.sessionName, "loop", loopCount)
			break
		}
	}

	if runErr != nil && errors.Is(runErr, context.Canceled) {
		// Cleanup: remove the last user message that triggered this aborted run
		log.Get().Info("run aborted, popping last user message", "session", a.sessionName)
		a.store.Pop()
	}

	log.Get().Info("run completed", "session", a.sessionName, "loops", loopCount, "error", runErr)
	a.saveSession()
	return true, nil
}

// Abort cancels the currently running LLM request.
func (a *Agent) Abort() {
	a.mu.Lock()
	defer a.mu.Unlock()
	if a.cancelFunc != nil {
		log.Get().Info("abort requested", "session", a.sessionName)
		a.cancelFunc()
	}
}

// ClearSession resets the conversation.
func (a *Agent) ClearSession() {
	log.Get().Info("clearing session", "session", a.sessionName)
	a.store.Clear()
	a.tokenMgr.Reset()
	if a.onTokenUpdate != nil {
		a.onTokenUpdate(0)
	}
}

// LoadSession restores saved messages into the agent.
func (a *Agent) LoadSession(name string) error {
	log.Get().Info("loading session", "session", name)
	data, err := a.session.Get(name)
	if err != nil {
		log.Get().Error("load session failed", "session", name, "error", err)
		return err
	}
	a.sessionName = name
	a.store.SetTurns(data.Messages)
	a.tokenMgr.Reset()
	a.tokenMgr.Add(data.TotalTokens, 0, 0, 0)
	if a.onTokenUpdate != nil {
		a.onTokenUpdate(a.tokenMgr.Total())
	}
	log.Get().Info("session loaded", "session", name, "turns", len(data.Messages), "tokens", data.TotalTokens)
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
		log.Get().Error("stream request failed", "error", err)
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
			log.Get().Error("stream event error", "error", evt.Error)
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
				if t, ok := tools.Get(evt.Block.Name); ok {
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
	defs := make([]llm.Tool, 0, len(a.toolList))
	for _, t := range a.toolList {
		defs = append(defs, llm.Tool{
			Name:        t.Name(),
			Description: t.Description(),
			InputSchema: t.InputSchema(),
		})
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
		AgentFactory:   &agentFactory{},
		SetModelFn:     a.SetModel,
		Logger:         log.Get(),
	}

	var results []toolResultItem
	for i, call := range calls {
		args, _ := call.Block.Input.(map[string]any)
		if args == nil {
			args = map[string]any{}
		}

		log.Get().Info("executing tool", "index", i, "name", call.Tool.Name(), "id", call.Block.ID)

		// Permission Check
		if !call.Tool.ReadOnly() && tc.PermissionSvc != nil {
			displayText := fmt.Sprintf("%s(%v)", call.Tool.Name(), args)
			allowed, reason := tc.PermissionSvc.Check(call.Tool.Name(), displayText, args)
			if !allowed {
				log.Get().Info("tool denied by permission", "name", call.Tool.Name(), "reason", reason, "mode", tc.PermissionSvc.Mode())
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
				a.store.AddStatus(domain.RoleError, fmt.Sprintf(`Tool "%s" was denied by user`, call.Tool.Name()))
				return true, nil
			}
		}

		result, execErr := call.Tool.Execute(ctx, args, tc)
		if execErr != nil {
			if de, ok := execErr.(*tools.ToolDeniedError); ok {
				// Tool was denied by user (e.g. AskUser cancelled): stop remaining
				log.Get().Info("tool denied by user", "name", call.Tool.Name(), "reason", de.Reason)
				results = append(results, toolResultItem{ToolUseID: call.Block.ID, Content: de.Reason})
				for j := i + 1; j < len(calls); j++ {
					results = append(results, toolResultItem{ToolUseID: calls[j].Block.ID, Content: de.Reason})
				}
				a.store.AddToolResults(results)
				a.store.AddStatus(domain.RoleError, fmt.Sprintf(`Tool "%s" was denied by user`, call.Tool.Name()))
				return true, nil
			}
			log.Get().Error("tool execution failed", "name", call.Tool.Name(), "error", execErr)
			results = append(results, toolResultItem{ToolUseID: call.Block.ID, Content: fmt.Sprintf("Error: %s", execErr.Error())})
			continue
		}
		log.Get().Info("tool execution succeeded", "name", call.Tool.Name(), "output_length", len(result.Output))
		results = append(results, toolResultItem{ToolUseID: call.Block.ID, Content: result.Output})
	}

	a.store.AddToolResults(results)
	return false, nil
}

func (a *Agent) processTokenUsage(usage *domain.Usage) {
	if usage == nil {
		return
	}
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
		log.Get().Info("compression skipped: already in progress", "session", a.sessionName)
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
		log.Get().Info("compression skipped: not enough messages", "session", a.sessionName, "turns", len(turns))
		a.store.AddStatus(domain.RoleStatus, "(Not enough messages to compress)")
		return nil
	}

	log.Get().Info("compression started", "session", a.sessionName, "messages_to_compress", len(turns)-keepRecent, "tokens", a.tokenMgr.Total())
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
	log.Get().Info("compression completed", "session", a.sessionName, "compressed_turns", len(compressed))
	a.store.AddStatus(domain.RoleStatus, fmt.Sprintf("(Compressed to %d turns)", len(compressed)))
	return nil
}

func getCwd() string {
	if cwd, err := os.Getwd(); err == nil {
		return cwd
	}
	return "unknown"
}

// agentFactory implements tools.AgentFactory to avoid circular imports.
type agentFactory struct{}

func (f *agentFactory) Create(cfg domain.AgentConfig) any {
	agent := NewAgent(cfg)
	agent.toolList = tools.SubAgentTools()
	return agent
}

func (f *agentFactory) Run(ctx context.Context, ag any, task string) error {
	agent := ag.(*Agent)
	_, err := agent.Run(ctx, task, "")
	return err
}

func (f *agentFactory) GetTurns(ag any) []domain.MessageParam {
	agent := ag.(*Agent)
	return agent.store.Turns()
}
