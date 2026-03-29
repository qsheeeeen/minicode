# 多模型审查功能设计

## 概述

通过 `/review` 命令触发多模型协作审查，让另一个模型与当前模型进行多轮辩论，发现设计中的盲点和问题。

## 核心设计

### 命令格式

```bash
/review              # 默认 1 轮审查
/review 3            # 3 轮辩论
/review --model glm-4.7  --rounds 2    # 指定模型和轮数
```

> **设计决策**：使用 `--model` 和 `--rounds` 显式参数，避免位置参数歧义（`/review glm-4.7 2` 无法区分模型名和轮数）。`--rounds` 可简写为 `-r`，`--model` 可简写为 `-m`。未指定时从 config 读取默认值。

### 对话流程

```
[正常对话]
User: 重构 src/services/auth.ts，添加 OAuth
Agent (Claude): [设计方案]

User: /review -r 2
    ↓
┌─────────────────────────────────────────┐
│ Round 1                                  │
│ ─────────────────────────────────────── │
│ Reviewer (智谱):                         │
│   "我审查了这个方案，发现几个问题：        │
│    1. 缺少 token 刷新机制                │
│    2. 没有处理并发请求导致的 token 过期"  │
│                                          │
│ Designer (Claude):                       │
│   "好建议！补充：                         │
│    1. 添加 TokenRefresher 类             │
│    2. 使用锁机制避免并发刷新"             │
└─────────────────────────────────────────┘
    ↓
┌─────────────────────────────────────────┐
│ Round 2                                  │
│ ─────────────────────────────────────── │
│ Reviewer (智谱):                         │
│   "还是有问题：                           │
│    1. 锁可能导致性能瓶颈                 │
│    2. 建议用乐观锁 + 重试"               │
│                                          │
│ Designer (Claude):                       │
│   "采纳！最终方案：..."                   │
└─────────────────────────────────────────┘
    ↓
[回到正常对话]
Agent (Claude): 根据审查结果，最终方案是...
User: 好的，开始实现
```

## 实现结构

### 1. 命令注册

```typescript
// src/cli/commands.ts
commandRegistry.register({
  name: 'review',
  description: '触发多模型审查辩论 /review [-r rounds] [-m model]',
  handler: async (ctx, args) => {
    const parsed = parseReviewArgs(args); // { rounds: number, model?: string }
    await startReview(ctx, parsed.rounds, parsed.model);
  }
});

function parseReviewArgs(args: string[]): { rounds: number; model?: string } {
  let rounds = 1;
  let model: string | undefined;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '-r' || args[i] === '--rounds') {
      rounds = parseInt(args[++i]) || 1;
    } else if (args[i] === '-m' || args[i] === '--model') {
      model = args[++i];
    } else if (/^\d+$/.test(args[i])) {
      // 兼容: /review 3
      rounds = parseInt(args[i]);
    }
  }

  return { rounds: Math.min(rounds, config.review.maxRounds), model };
}
```

### 2. 多 Provider LLM Client

当前 `Agent` 只持有一个 LLM client。审查需要调用另一个 provider，需要一个独立的轻量 client。

```typescript
// src/llm/review-client.ts

interface ReviewClientConfig {
  apiKey: string;
  baseURL: string;
  model: string;
}

class ReviewClient {
  // 轻量 client，只做纯 chat（无 tool use、无 streaming）
  async chat(system: string, messages: Message[]): Promise<string>;

  // 根据 model@provider 从 config 解析出 provider 配置
  static fromConfig(modelSpecifier: string): ReviewClient;
}
```

**为什么需要独立 client：**
- 审查模型可能是非 Anthropic provider（如 zhipu），API 格式不同
- 不需要 tool use、streaming、extended thinking 等能力
- 复用现有 config 的 providers 结构，但走独立的 HTTP 调用

**实现选择：**
- 方案 A：直接用 fetch 调用 OpenAI-compatible API（zhipu 等国产模型基本兼容）
- 方案 B：为每个 provider 写 adapter
- **推荐方案 A**：Phase 1 只支持 OpenAI-compatible 接口，覆盖大多数 provider

### 3. 审查服务

```typescript
// src/services/review-service.ts

const REVIEWER_PROMPT = `
你是审查者。你的任务是：
1. 找出设计方案中的遗漏点
2. 识别潜在的风险和边界情况
3. 提出更简单的替代方案
4. 质疑假设，但不否定整个方案

风格：直接、具体、建设性。
`;

async function startReview(
  agent: Agent,
  rounds: number,
  reviewerModel?: string
): Promise<void> {
  const modelSpecifier = reviewerModel || config.review.defaultReviewer;
  const client = ReviewClient.fromConfig(modelSpecifier);

  const conversation = agent.getConversationHistory();
  const contextWindow = conversation.slice(-config.review.contextLimit);
  const lastProposal = getLastAssistantMessage(conversation);

  let currentProposal = lastProposal;

  for (let i = 1; i <= rounds; i++) {
    // Reviewer 审查（调用外部模型）
    const review = await client.chat(REVIEWER_PROMPT, [
      ...contextWindow,
      { role: 'assistant', content: currentProposal }
    ]);

    agent.display.addMessage('reviewer', `[Round ${i}/${rounds}] ${modelSpecifier}`, review);

    // 原模型回应（通过 agent 的现有 LLM client）
    const response = await agent.chat({
      messages: [
        ...contextWindow,
        { role: 'assistant', content: currentProposal },
        { role: 'user', content: `审查意见：\n${review}\n\n请回应这些意见，必要时调整方案。` }
      ]
    });

    agent.display.addMessage('designer', `[Round ${i}/${rounds}]`, response);

    currentProposal = response;
  }
}
```

### 4. Session 持久化策略

> **设计决策**：审查轮次作为独立 `role: 'review'` 消息存入 session 历史。

**理由：**
- 用户关闭再恢复 session 时，需要看到之前的审查结果
- 审查结果对后续对话有参考价值（"你刚才审查时说锁有性能问题"）

**代价与缓解：**
- 上下文膨胀：审查消息较多时占用 token 预算 → 压缩服务自动处理（已有机制）
- 与现有 role 类型不兼容：当前 `DisplayMessage` 只有 `user/assistant/tool/system` → 新增 `reviewer`/`designer` 角色或在 system message 中编码

**Phase 1 折中方案：** 审查轮次存为 system 消息，用前缀标记：
```
[System] Review Round 1/2 (glm-4.7@zhipu): ...
[System] Review Response 1/2: ...
```

### 5. TUI 展示

审查消息在 Message 组件中作为 system 角色渲染，用不同前缀区分：
- `[Review R1/3] glm-4.7@zhipu` — 审查者意见
- `[Response R1/3]` — 原模型回应

不需要特殊的框线样式，复用现有 system 消息的灰色渲染。理由：保持 TUI 实现简单，框线在终端宽度变化时容易错位。

### 6. 配置

```json
{
  "review": {
    "enabled": true,
    "defaultReviewer": "glm-4.7@zhipu",
    "maxRounds": 5,
    "contextLimit": 10,
    "reviewerSystemPrompt": "你是审查者，找出方案的问题、风险、遗漏"
  }
}
```

## 使用场景

### 1. 复杂重构前的方案审查

```bash
User: 重构整个数据层，切换到 PostgreSQL
Agent: [设计方案]
User: /review -r 3
```

### 2. 关键代码的双重确认

```bash
User: 实现支付逻辑，处理扣款和回调
Agent: [代码实现]
User: /review -r 2
```

### 3. 不确定时的第二意见

```bash
User: 这个 bug 原因是？
Agent: [分析]
User: /review -m glm-4.7
```

### 4. 架构决策

```bash
User: 设计一个实时消息系统
Agent: [架构方案]
User: /review -r 5  # 深度辩论
```

## 优势

- **简单**：一个命令，不改变主流程
- **灵活**：可以指定模型和轮数
- **按需**：不需要时就不触发
- **可见**：辩论过程透明展示
- **互补**：不同模型有不同的盲区

## 待确认问题

1. **agent.chat() 接口**：当前 Agent 的 LLM 调用嵌入在 `run()` 循环中，没有独立的 `chat()` 方法。实现时需要决定：抽取一个 `agent.sendMessages(messages)` 方法，还是在 review-service 中直接访问 `agent.llm`。
2. **流式展示**：审查过程是否需要流式输出？Phase 1 建议等待完整响应后再展示，降低实现复杂度。
3. **中止机制**：长轮次审查时，用户可能想中止（Ctrl+C）。需要考虑如何打断进行中的审查循环。

## 实现优先级

1. **Phase 1**: 基础功能
   - `/review` 命令注册
   - 单轮审查，固定 reviewer 模型
   - `ReviewClient`：OpenAI-compatible fetch 调用
   - 审查结果作为 system 消息存入 session
   - 非流式展示

2. **Phase 2**: 增强功能
   - 多轮辩论
   - `--model` 参数支持任意 provider
   - 流式输出审查过程
   - 中止机制

3. **Phase 3**: 优化
   - 审查历史缓存（避免重复调用相同上下文）
   - 自动上下文裁剪（基于 token 而非消息条数）
   - 投票模式：多 reviewer 并行审查

## 注意事项

1. **成本**: 每轮审查消耗额外的 token 和 API 调用
2. **延迟**: 增加了响应时间
3. **上下文**: 审查模型需要看到足够的上下文，但不是全部
4. **冲突**: 两个模型可能陷入无休止的争论（需要 maxRounds 限制）
