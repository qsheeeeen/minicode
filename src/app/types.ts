import type { Agent } from "../agent.js";
import type { AppConfig } from "../config.js";
import type { AgentRegistry, SessionStats } from "../services/index.js";
import type { ContextManager } from "../services/context-manager.js";
import type { ModelSwitchService } from "../services/model-switcher.js";
import type { PermissionService } from "../services/permission.js";
import type { ShellService } from "../services/shell-service.js";
import type { SessionManager } from "../services/session-manager.js";
import type { CommandContext } from "../ui/commands/index.js";

export interface AppRuntime {
  readonly agent: Agent;
  readonly config: AppConfig;
  readonly version: string;
  readonly promptFiles: string[];
  readonly initialSession: string;
  readonly initialPrompt?: string;
  readonly sessionName?: string;
  readonly resumeRecent: boolean;
  readonly headless: boolean;
  readonly programStartTime: number;
  readonly agentRegistry: AgentRegistry;
  readonly sessionStats: SessionStats;
  readonly sessionManager: SessionManager;
  readonly contextManager: ContextManager;
  readonly permissionService: PermissionService;
  readonly modelSwitchService: ModelSwitchService;
  readonly shellService: ShellService;
  readonly commandContext: CommandContext;
}
