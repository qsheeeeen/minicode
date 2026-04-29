import type { Agent } from '../agent.js';
import type { AgentMessage } from '../messages.js';
import { elementToText } from '../utils/react.js';
import type { SessionManager } from '../utils/session.js';

export async function runHeadless(
  agent: Agent,
  initialPrompt: string,
  sessionManager: SessionManager,
  sessionName?: string,
  resumeRecent?: boolean,
): Promise<void> {
  // Load session if requested
  if (sessionName || resumeRecent) {
    const targetName = sessionName || (async () => {
      const recent = await sessionManager.getMostRecent();
      return recent || `session-${Date.now()}`;
    })();

    const name = await (async () => {
      if (sessionName) return sessionName;
      const recent = await sessionManager.getMostRecent();
      return recent || `session-${Date.now()}`;
    })();

    const data = await sessionManager.get(name);
    if (data) {
      agent.setMessages(data.messages as any);
      const totalTokens = data.totalTokens || 0;
      if (totalTokens > 0) {
        agent.setTokenCount(totalTokens);
      }
      const { createLogger } = await import('../utils/logger.js');
      const newLogger = await createLogger(sessionManager.getProjectHash(), name);
      agent.setSession(name, newLogger);
    }
  }
  // Set headless display: confirm always denies
  agent.setDisplay({
    status: () => {},
    error: (msg) => console.error(`[error] ${msg}`),
    updateTokenCount: () => {},
    confirm: async (req) => {
      console.log(`[Permission denied: ${req.message}] -- use --permission yolo or auto in headless mode`);
      return false;
    },
  });

  let lastPrintedIndex = 0;
  const streamed = new Map<string, number>();       // assistant msgId → chars printed
  const finalized = new Set<string>();               // msgIds with newline written
  const toolCallLines = new Map<string, number>();   // tool_use msgId → lines printed

  agent.getStore().onChange(() => {
    const raw = agent.getStore().getAll();

    // 1. Print new messages that don't need streaming tracking
    for (let i = lastPrintedIndex; i < raw.length; i++) {
      const msg = raw[i];
      // Skip: assistant (streamed), thinking (deferred), tool_use (element-tracked)
      if (msg.role === 'user' || msg.role === 'status' || msg.role === 'error') {
        printMessage(msg);
      }
    }
    lastPrintedIndex = raw.length;

    // 2. Track tool_use element updates — element grows from callFormat to callFormat + result
    for (const msg of raw) {
      if (msg.role === 'tool_use' && msg.element) {
        const text = elementToText(msg.element);
        const lines = text.split('\n');
        const printedCount = toolCallLines.get(msg.id) || 0;
        // Add separator + prefix before first tool call output
        if (printedCount === 0 && lines.length > 0) {
          process.stdout.write('\n[tool] ');
        }
        for (let j = printedCount; j < lines.length; j++) {
          if (lines[j]) console.log(j === 0 ? lines[j] : `       ${lines[j]}`);
        }
        if (lines.length > printedCount) {
          toolCallLines.set(msg.id, lines.length);
        }
      }
    }

    // 3. Stream assistant text incrementally
    for (const msg of raw) {
      if (msg.role === 'assistant' && msg.content) {
        const printed = streamed.get(msg.id) || 0;
        if (msg.content.length > printed) {
          // Add prefix before first chunk of assistant text
          if (printed === 0) {
            process.stdout.write('\n[assistant] ');
          }
          process.stdout.write(msg.content.slice(printed));
          streamed.set(msg.id, msg.content.length);
        }
        if (!msg.isStreaming && !finalized.has(msg.id)) {
          process.stdout.write('\n');
          finalized.add(msg.id);
        }
      }

      // 4. Thinking: print when finalized, full content
      if (msg.role === 'thinking' && !msg.isStreaming && msg.content && !finalized.has(msg.id)) {
        console.log(`\n[thinking] ${msg.content}`);
        finalized.add(msg.id);
      }
    }
  });

  try {
    await agent.run(initialPrompt);
  } catch (e) {
    if (e instanceof Error && e.message === 'Aborted') {
      console.log('(Aborted)');
    } else if (e instanceof Error) {
      console.error(`(Error: ${e.message})`);
    } else {
      throw e;
    }
  }
}

function printMessage(msg: AgentMessage): void {
  switch (msg.role) {
    case 'user':
      process.stdout.write(`[user] ${msg.content}\n\n`);
      break;

    case 'status':
      console.log(`[status] ${msg.content}`);
      break;

    case 'error':
      console.error(`[error] ${msg.content}`);
      break;
  }
}
