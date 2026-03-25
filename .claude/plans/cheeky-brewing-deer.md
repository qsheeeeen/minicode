# Plan: Parallel Tool Execution

## Context
Currently, tools execute sequentially even when Claude returns multiple independent tool calls in a single response. This is inefficient for operations like reading multiple files or running independent bash commands.

## Current Implementation
**File**: `src/agent/loop.ts` (lines 68-104)

Tools execute one-by-one in a for loop:
```typescript
for (const block of response.content) {
  if (block.type === 'tool_use') {
    const result = await tool.execute(toolBlock.input);  // Sequential
    // push result
  }
}
```

## Implementation Plan

### 1. Collect All Tool Calls First
**File**: `src/agent/loop.ts`

- First pass: Collect all `tool_use` blocks, display text blocks immediately
- Second pass: Execute all tool calls in parallel using `Promise.all()`

### 2. Parallel Execution with Promise.all()
```typescript
// First pass: collect tool calls and display text
const toolCalls: Array<{block, tool, display}> = [];

for (const block of response.content) {
  if (block.type === 'text') {
    console.log((block as any).text);
    (assistantMsg.content as any).push(block);
  } else if (block.type === 'tool_use') {
    const tool = this.tools.get(toolBlock.name);
    if (tool) {
      const display = tool.format ? tool.format(toolBlock.input) : `${toolBlock.name} ...`;
      console.log(`\n${display}`);
      toolCalls.push({ block: toolBlock, tool, display });
    }
  }
}

// Second pass: execute all tools in parallel
const results = await Promise.allSettled(
  toolCalls.map(({ block, tool }) => tool.execute(block.input))
);

// Push all results back
results.forEach((result, i) => {
  const { block } = toolCalls[i];
  const content = result.status === 'fulfilled' ? result.value : `Error: ${result.reason.message}`;
  this.messages.push({
    role: 'user',
    content: [{ type: 'tool_result', tool_use_id: block.id, content }]
  });
});
```

## Critical Files
- `src/agent/loop.ts` - Main loop, lines 64-104

## Verification
```bash
# Test with a prompt that triggers multiple reads
echo "Read package.json and tsconfig.json" | npm run start

# Should see both tool calls executed in parallel (faster completion)
```
