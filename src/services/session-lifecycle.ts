import type { Agent } from "../agent.js";
import type { SessionStats } from "./session-stats.js";
import { createLogger } from "../utils/logger.js";
import { MessageStore } from "../messages.js";

export interface SessionSwitchOptions {
  agent: Agent;
  sessionName: string;
  setCurrentSession: (name: string) => void;
  sessionStats: SessionStats;
  statusMessage?: string;
}

export async function switchSession(opts: SessionSwitchOptions): Promise<void> {
  const logger = await createLogger(
    MessageStore.getProjectHash(),
    opts.sessionName,
  );
  opts.agent.setSession(opts.sessionName);
  opts.agent.setLogger(logger);
  opts.setCurrentSession(opts.sessionName);
  opts.sessionStats.incrementSessionCount(opts.sessionName);
  if (opts.statusMessage) {
    opts.agent.getStore().addStatus({
      role: "status",
      content: opts.statusMessage,
      timestamp: new Date(),
    });
  }
}
