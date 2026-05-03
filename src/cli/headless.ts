import type { Agent } from '../agent.js';
import type { MessageParam, ContentBlock } from '../llm/anthropic.js';
import { sessionManager } from '../utils/session.js';

export async function runHeadless(
  agent: Agent,
  initialPrompt: string,
  sessionName?: string,
  resumeRecent?: boolean,
): Promise<void> {
  // Load session if requested
  if (sessionName || resumeRecent) {
    const name = sessionName ?? (await sessionManager.getMostRecent()) ?? `session-${Date.now()}`;
    const data = await sessionManager.get(name);
    if (data) {
      agent.setMessages(data.messages as any);
      const totalTokens = data.totalTokens || 0;
      if (totalTokens > 0) {
        agent.setTokenCount(totalTokens);
      }
      const { createLogger } = await import('../utils/logger.js');
      const newLogger = await createLogger(sessionManager.getProjectHash(), name);
      agent.setSession(name);
      agent.setLogger(newLogger);
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

  let printedTurns = 0;
  const printedBlocks = new Map<number, number>();        // turnIndex → blocks printed so far
  const streamedChars = new Map<string, number>();         // "turnIdx:blockIdx" → chars printed
  const finalizedBlocks = new Set<string>();               // "turnIdx:blockIdx" → finalized (printed newline)
  const printedToolUses = new Set<string>();               // tool_use block IDs already printed
  const printedResults = new Set<string>();                // tool_use IDs whose results have been printed

  agent.getStore().onChange(() => {
    const turns = agent.getStore().getTurns();
    const statuses = agent.getStore().getStatuses();

    for (let ti = printedTurns; ti < turns.length; ti++) {
      const turn = turns[ti];
      if (turn.role === 'user') {
        if (typeof turn.content === 'string') {
          process.stdout.write(`[user] ${turn.content}\n\n`);
        }
        // tool_result turns are not printed separately; they appear under tool_use
        printedTurns = ti + 1;
        continue;
      }

      if (turn.role === 'assistant' && Array.isArray(turn.content)) {
        const blocks = turn.content as ContentBlock[];
        const blocksPrinted = printedBlocks.get(ti) || 0;

        for (let bi = blocksPrinted; bi < blocks.length; bi++) {
          const block = blocks[bi];
          const blockKey = `${ti}:${bi}`;

          // --- thinking: print when it stops growing ---
          if (block.type === 'thinking') {
            const prevLen = streamedChars.get(blockKey) || 0;
            if (block.thinking.length > prevLen) {
              // First time printing this thinking block
              if (prevLen === 0) process.stdout.write(`\n[thinking] `);
              process.stdout.write(block.thinking.slice(prevLen));
              streamedChars.set(blockKey, block.thinking.length);
            }
            // Check if this block is finalized (not the last block of the last turn)
            const isLastBlock = ti === turns.length - 1 && bi === blocks.length - 1;
            if (!isLastBlock && !finalizedBlocks.has(blockKey)) {
              process.stdout.write('\n');
              finalizedBlocks.add(blockKey);
            }
          }

          // --- text: stream incrementally ---
          if (block.type === 'text') {
            const prevLen = streamedChars.get(blockKey) || 0;
            if (block.text.length > prevLen) {
              if (prevLen === 0) process.stdout.write('\n[assistant] ');
              process.stdout.write(block.text.slice(prevLen));
              streamedChars.set(blockKey, block.text.length);
            }
            const isLastBlock = ti === turns.length - 1 && bi === blocks.length - 1;
            if (!isLastBlock && !finalizedBlocks.has(blockKey)) {
              process.stdout.write('\n');
              finalizedBlocks.add(blockKey);
            }
          }

          // --- tool_use: print call line + immediate result ---
          if (block.type === 'tool_use' && !printedToolUses.has(block.id)) {
            printedToolUses.add(block.id);
            const callText = `${block.name}(${JSON.stringify(block.input)})`;
            process.stdout.write(`\n[tool] ${callText}\n`);

            // Scan subsequent turns for matching tool_result
            for (let rti = ti + 1; rti < turns.length; rti++) {
              const rt = turns[rti];
              if (rt.role === 'user' && Array.isArray(rt.content)) {
                for (const rb of rt.content as any[]) {
                  if (rb.type === 'tool_result' && rb.tool_use_id === block.id) {
                    const raw = typeof rb.content === 'string' ? rb.content : JSON.stringify(rb.content);
                    const lines = raw.split('\n');
                    for (const line of lines) {
                      if (line) console.log(`       ${line}`);
                    }
                    printedResults.add(block.id);
                  }
                }
              }
            }
          }
        }

        // Track progress
        const isLastTurn = ti === turns.length - 1;
        if (!isLastTurn) {
          printedBlocks.set(ti, blocks.length);
          printedTurns = ti + 1;
        } else {
          // Don't finalize the last turn's last block — it may still be streaming
          printedBlocks.set(ti, blocks.length > 0 ? blocks.length - 1 : 0);
        }
      }
    }

    // Print tool results for any printed tool_use blocks
    for (const turn of turns) {
      if (turn.role === 'user' && Array.isArray(turn.content)) {
        for (const block of turn.content as any[]) {
          if (block.type === 'tool_result' && printedToolUses.has(block.tool_use_id) && !printedResults.has(block.tool_use_id)) {
            printedResults.add(block.tool_use_id);
            const raw = typeof block.content === 'string' ? block.content : JSON.stringify(block.content);
            const lines = raw.split('\n');
            for (const line of lines) {
              if (line) console.log(`       ${line}`);
            }
          }
        }
      }
    }

    // Print any new status messages
    for (const s of statuses) {
      if (s.role === 'error') console.error(`[error] ${s.content}`);
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
