# 多 Agent 协作功能设计

## 概述

通过 `/delegate` 命令引入第二个 agent，与主 agent 协作完成特定任务。

> **核心原则**：第二个 agent 是**同等智能的不同模型**，不是 fast-but-less-smart 的模型，也不是主 agent 的分身。

**为什么需要不同模型**：
- 不同训练数据 → 不同知识盲区
- 不同思维模式 → 不同解题思路
- 不同偏好 → 不同权衡选择

**为什么不是分身**：同一模型的不同 context 只会得出类似结论，没有交叉验证价值。

## 协作模式

### 1. Review（审查辩论）

第二个 agent 作为审查者，与主 agent 进行多轮辩论，发现设计中的盲点。

```bash
/delegate review [-r 3]           # 3 轮辩论，使用配置的默认审查模型
/delegate review -m glm-4.7       # 指定审查模型
```

**流程**：
```
[主 Agent 方案]
    ↓
[Reviewer] → 找问题
[主 Agent] → 回应调整
[Reviewer] → 深入质疑
[主 Agent] → 最终方案
```

**适用场景**：复杂重构、架构决策、关键代码审查

---

### 2. Alternative（备选方案）

第二个 agent 生成**不同的方案**，供用户对比选择。

```bash
/delegate alternative             # 生成一个备选方案
/delegate alternative -n 2        # 生成 2 个备选方案（并行）
```

**流程**：
```
[主 Agent] 方案 A: 基于 React + Redux
    ↓
[Delegate Agent] 方案 B: 基于 Zustand
    ↓
User 选择：A 或 B 或融合
```

**适用场景**：技术选型、架构设计、实现路径不确定

---

### 3. Compete（竞争生成）

多个 agent **并行**生成解决方案，用户选择最好的。

```bash
/delegate compete                 # 2 个模型竞争
/delegate compete -n 3            # 3 个模型竞争
/delegate compete -m "glm-4.7,deepseek-chat"  # 指定竞争模型
```

**流程**：
```
                    ┌─→ [Agent A] → 方案 A ─┐
[当前上下文] ────────┼─→ [Agent B] → 方案 B ─┼→ 用户评审/选择
                    └─→ [Agent C] → 方案 C ─┘
```

**适用场景**：创意方案、代码生成、问题诊断

---

## 命令格式

```bash
# 通用格式
/delegate <mode> [options]

# Review
/delegate review [-r rounds] [-m model]

# Alternative
/delegate alternative [-n count] [-m model]

# Compete
/delegate compete [-n count] [-m model1,model2,...]
```

**参数说明**：
- `-r, --rounds` - 审查轮数（仅 review）
- `-n, --count` - Agent/方案数量（alternative/compete）
- `-m, --model` - 指定模型，格式：`model@provider` 或逗号分隔列表

## 实现结构

### 1. 命令注册

```typescript
// src/cli/commands.ts
commandRegistry.register({
  name: 'delegate',
  description: '引入第二个 agent 协作 /delegate <mode> [options]',
  handler: async (ctx, args) => {
    const mode = args[0]; // review | alternative | compete
    const options = parseDelegateArgs(args.slice(1));
    await delegateManager.execute(mode, ctx, options);
  }
});
```

### 2. Delegate Manager

```typescript
// src/services/delegate-manager.ts

class DelegateManager {
  private modes: Map<string, DelegateMode>;

  constructor(private config: DelegateConfig) {
    this.modes = new Map([
      ['review', new ReviewMode(config)],
      ['alternative', new AlternativeMode(config)],
      ['compete', new CompeteMode(config)],
    ]);
  }

  async execute(mode: string, ctx: CommandContext, options: Options): Promise<void> {
    const handler = this.modes.get(mode);
    if (!handler) throw new Error(`Unknown delegate mode: ${mode}`);
    await handler.execute(ctx, options);
  }
}
```

### 3. 模式接口

```typescript
// src/services/delegate-modes.ts

interface DelegateMode {
  execute(ctx: CommandContext, options: Options): Promise<void>;
}

class ReviewMode implements DelegateMode {
  async execute(ctx: CommandContext, options: Options): Promise<void> {
    const reviewer = ReviewClient.fromConfig(options.model ?? config.defaults.review);
    const rounds = options.rounds ?? 1;

    for (let i = 1; i <= rounds; i++) {
      // Reviewer 审查
      const review = await reviewer.chat(/* ... */);
      ctx.display.add({ role: 'delegate', label: `[Review R${i}/${rounds}] ${reviewer.model}`, content: review });

      // 主 agent 回应
      const response = await ctx.agent.chat(/* ... */);
      ctx.display.add({ role: 'assistant', content: response });
    }
  }
}

class AlternativeMode implements DelegateMode {
  async execute(ctx: CommandContext, options: Options): Promise<void> {
    const delegate = ReviewClient.fromConfig(options.model ?? config.defaults.alternative);
    const alt = await delegate.chat(/* 生成不同方案 */);
    ctx.display.add({ role: 'delegate', label: '[Alternative]', content: alt });
  }
}

class CompeteMode implements DelegateMode {
  async execute(ctx: CommandContext, options: Options): Promise<void> {
    const models = options.models ?? [config.defaults.compete1, config.defaults.compete2];
    const results = await Promise.all(
      models.map(m => ReviewClient.fromConfig(m).chat(/* ... */))
    );
    results.forEach((r, i) => {
      ctx.display.add({ role: 'delegate', label: `[Compete ${i + 1}] ${models[i]}`, content: r });
    });
  }
}
```

### 4. 多 Provider LLM Client

```typescript
// src/llm/delegate-client.ts

interface DelegateClientConfig {
  apiKey: string;
  baseURL: string;
  model: string;
}

class DelegateClient {
  private config: DelegateClientConfig;

  constructor(config: DelegateClientConfig) {
    this.config = config;
  }

  async chat(system: string, messages: Message[]): Promise<string> {
    // OpenAI-compatible fetch
    const response = await fetch(`${this.config.baseURL}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.config.apiKey}`,
      },
      body: JSON.stringify({
        model: this.config.model,
        messages: [{ role: 'system', content: system }, ...messages],
      }),
    });
    // ...
  }

  static fromConfig(modelSpecifier: string): DelegateClient {
    const [model, provider] = parseModelSpecifier(modelSpecifier);
    const config = loadConfig().providers[provider];
    return new DelegateClient({
      apiKey: config.apiKey,
      baseURL: config.baseURL,
      model,
    });
  }
}
```

## 配置

```json
{
  "model": "claude-sonnet-4-5@anthropic",
  "secondaryModel": "glm-4.7@zhipu",
  "compressionThreshold": 0.8,
  "thinking": false,
  "thinkingTokens": 20000,
  "promptFile": "MINICODE.md",
  "delegate": {
    "maxRounds": 5,
    "contextLimit": 10,
    "reviewPrompt": "你是审查者。找出方案的问题、风险、遗漏。",
    "alternativePrompt": "生成一个与当前方案不同的替代方案。",
    "competePrompt": "基于当前上下文，给出你的最佳解决方案。"
  }
}
```

- `secondaryModel` - 默认的第二个 agent（同级模型）
- `-m` 参数可覆盖：`/delegate review -m deepseek-chat@deepseek`

## Session 持久化

Delegate 消息作为特殊 role 存入 session：

```typescript
{
  role: 'delegate',
  mode: 'review' | 'alternative' | 'compete',
  model: string,
  round?: number,
  totalRounds?: number,
  content: string
}
```

TUI 展示时转换为 system 消息样式：
- `[Delegate Review R1/3] glm-4.7@zhipu: ...`
- `[Delegate Alternative] deepseek-chat: ...`
- `[Delegate Compete 1/3] glm-4.7@zhipu: ...`

## 使用场景

| 场景 | 模式 | 示例 |
|------|------|------|
| 复杂重构 | review | `/delegate review -r 3` |
| 技术选型 | alternative | `/delegate alternative` |
| 创意方案 | compete | `/delegate compete -n 3` |
| 代码审查 | review | `/delegate review -m deepseek-chat` |
| Bug 诊断 | compete | `/delegate compete` |
| 架构设计 | review + alternative | 先 review 深化，再 alternative 对比 |

## 与普通命令的区别

| | 普通命令 (`/compress`) | Delegate 命令 (`/delegate review`) |
|---|---|---|
| 执行者 | 主 agent | 第二个 agent (+ 主 agent) |
| 目的 | 工具功能 | 协作产生新价值 |
| 上下文 | 读取当前状态 | 独立分析当前状态 |
| 输出 | 状态变更 | 新的观点/方案 |

## 实现优先级

### Phase 1：核心框架
- `/delegate review` - 单轮审查
- `DelegateClient` - OpenAI-compatible
- 命令解析和模式分发
- Session 持久化

### Phase 2：多模式
- `/delegate alternative`
- `/delegate compete`
- 多轮 review
- 并行调用

### Phase 3：优化
- 流式输出
- 中止机制
- 成本预估提示
- 审查历史缓存

## 注意事项

1. **成本**：每个 delegate 额外消耗 token 和 API 调用
2. **延迟**：增加了响应时间，尤其是 compete 模式并行等待
3. **上下文**：delegate 需要足够上下文，但不是全部
4. **冲突**：review 可能陷入争论（maxRounds 限制）
