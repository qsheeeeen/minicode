import type { Agent } from "../agent.js";
import type { MessageParam, ContentBlock } from "../llm/types.js";
import type { CommandContext } from "./commands/index.js";
import { routeInput } from "./routing.js";
import { runBash } from "../services/index.js";
import { MessageStore } from "../messages.js";

export async function runHeadless(
  agent: Agent,
  initialPrompt: string,
  sessionName?: string,
  resumeRecent?: boolean,
  cmdContext?: CommandContext,
): Promise<void> {
  // Load session if requested
  if (sessionName || resumeRecent) {
    const name =
      sessionName ??
      (await MessageStore.getMostRecent()) ??
      `session-${Date.now()}`;
    const data = await MessageStore.load(name);
    if (data) {
      agent.setMessages(data.messages);
      const totalTokens = data.totalTokens || 0;
      if (totalTokens > 0) {
        agent.setTokenCount(totalTokens);
      }
      const { createLogger } = await import("../utils/logger.js");
      const newLogger = await createLogger(
        MessageStore.getProjectHash(),
        name,
      );
      agent.setSession(name);
      agent.setLogger(newLogger);
    }
  }

  // Set headless events and prompter
  agent.setEvents({
    status: () => {},
    error: (msg) => console.error(`[error] ${msg}`),
    tokenUpdate: () => {},
  });
  agent.setPrompter({
    prompt: async (req) => {
      console.log(
        `[Denied: ${req.message}] -- use --permission yolo or auto in headless mode`,
      );
      return "";
    },
  });

  let printedTurns = 0;
  const printedBlocks = new Map<number, number>(); // turnIndex → blocks printed so far
  const streamedChars = new Map<string, number>(); // "turnIdx:blockIdx" → chars printed
  const finalizedBlocks = new Set<string>(); // "turnIdx:blockIdx" → finalized (printed newline)
  const printedToolUses = new Set<string>(); // tool_use block IDs already printed
  const printedResults = new Set<string>(); // tool_use IDs whose results have been printed

  function render(isFinal = false) {
    const turns = agent.getStore().getTurns();
    const statuses = agent.getStore().getStatuses();

    for (let ti = printedTurns; ti < turns.length; ti++) {
      const turn = turns[ti];
      const isLastTurn = ti === turns.length - 1;

      if (turn.role === "user") {
        if (typeof turn.content === "string") {
          process.stdout.write(`[user]\n${turn.content.trim()}\n\n`);
        }
        printedTurns = ti + 1;
        continue;
      }

      if (turn.role === "assistant" && Array.isArray(turn.content)) {
        const blocks = turn.content as ContentBlock[];
        const blocksPrinted = printedBlocks.get(ti) || 0;

        for (let bi = blocksPrinted; bi < blocks.length; bi++) {
          const block = blocks[bi];
          const blockKey = `${ti}:${bi}`;
          const isLastBlock = isLastTurn && bi === blocks.length - 1;

          if (block.type === "thinking") {
            const prevLen = streamedChars.get(blockKey) || 0;
            if (block.thinking.length > prevLen) {
              if (prevLen === 0) process.stdout.write(`[thinking]\n`);
              const content =
                prevLen === 0
                  ? block.thinking.trimStart()
                  : block.thinking.slice(prevLen);
              process.stdout.write(content);
              streamedChars.set(blockKey, block.thinking.length);
            }
            if ((!isLastBlock || isFinal) && !finalizedBlocks.has(blockKey)) {
              process.stdout.write(
                block.thinking.endsWith("\n") ? "\n" : "\n\n",
              );
              finalizedBlocks.add(blockKey);
            }
          }

          if (block.type === "text") {
            const prevLen = streamedChars.get(blockKey) || 0;
            if (block.text.length > prevLen) {
              if (prevLen === 0) process.stdout.write(`[assistant]\n`);
              const content =
                prevLen === 0
                  ? block.text.trimStart()
                  : block.text.slice(prevLen);
              process.stdout.write(content);
              streamedChars.set(blockKey, block.text.length);
            }
            if ((!isLastBlock || isFinal) && !finalizedBlocks.has(blockKey)) {
              process.stdout.write(block.text.endsWith("\n") ? "\n" : "\n\n");
              finalizedBlocks.add(blockKey);
            }
          }

          if (block.type === "tool_use" && !printedToolUses.has(block.id)) {
            printedToolUses.add(block.id);
            const callText = `${block.name}(${JSON.stringify(block.input)})`;
            process.stdout.write(`[tool] ${callText}\n`);

            // Scan subsequent turns for matching tool_result
            for (let rti = ti + 1; rti < turns.length; rti++) {
              const rt = turns[rti];
              if (rt.role === "user" && Array.isArray(rt.content)) {
                for (const rb of rt.content) {
                  if (
                    rb.type === "tool_result" &&
                    rb.tool_use_id === block.id
                  ) {
                    const raw =
                      typeof rb.content === "string"
                        ? rb.content
                        : JSON.stringify(rb.content);
                    const lines = raw.split("\n");
                    for (const line of lines) {
                      if (line) process.stdout.write(`       ${line}\n`);
                    }
                    if (!isLastBlock || isFinal) process.stdout.write("\n");
                    printedResults.add(block.id);
                  }
                }
              }
            }
          }
        }

        // Track progress
        if (!isLastTurn) {
          printedBlocks.set(ti, blocks.length);
          printedTurns = ti + 1;
        } else if (isFinal) {
          printedBlocks.set(ti, blocks.length);
          printedTurns = ti + 1;
        } else {
          // While streaming, keep the last block "active"
          printedBlocks.set(ti, blocks.length > 0 ? blocks.length - 1 : 0);
        }
      }
    }

    // Print tool results for any printed tool_use blocks
    for (const turn of turns) {
      if (turn.role === "user" && Array.isArray(turn.content)) {
        for (const block of turn.content) {
          if (
            block.type === "tool_result" &&
            printedToolUses.has(block.tool_use_id) &&
            !printedResults.has(block.tool_use_id)
          ) {
            printedResults.add(block.tool_use_id);
            const raw =
              typeof block.content === "string"
                ? block.content
                : JSON.stringify(block.content);
            const lines = raw.split("\n");
            for (const line of lines) {
              if (line) console.log(`       ${line}`);
            }
            process.stdout.write("\n");
          }
        }
      }
    }

    // Print any new status messages
    for (const s of statuses) {
      if (s.role === "error") console.error(`[error] ${s.content}`);
      else if (s.toolDisplay) {
        const td = s.toolDisplay;
        console.log(`(${td.name}(${JSON.stringify(td.input)}) → ${td.output ?? ""})`);
      } else if (s.content) {
        console.log(s.content);
      }
    }
  }

  const unsubscribe = agent.getStore().onChange(() => render(false));

  // Input routing
  if (!cmdContext) {
    try {
      await agent.run(initialPrompt);
      render(true);
    } catch (e) {
      if (e instanceof Error && e.message === "Aborted") {
        console.log("(Aborted)");
      } else if (e instanceof Error) {
        console.error(`(Error: ${e.message})`);
      } else {
        throw e;
      }
    } finally {
      unsubscribe();
    }
    return;
  }

  const route = await routeInput(initialPrompt, cmdContext);

  if (route.action === "none") {
    unsubscribe();
    return;
  }

  if (route.action === "bash") {
    const output = runBash(route.promptText!);
    console.log(`$ ${route.promptText}\n${output}`);
    unsubscribe();
    return;
  }

  if (route.action === "command" && !route.promptText) {
    render(true);
    unsubscribe();
    return;
  }

  try {
    await agent.run(route.promptText!);
    render(true);
  } catch (e) {
    if (e instanceof Error && e.message === "Aborted") {
      console.log("(Aborted)");
    } else if (e instanceof Error) {
      console.error(`(Error: ${e.message})`);
    } else {
      throw e;
    }
  } finally {
    unsubscribe();
  }
}
