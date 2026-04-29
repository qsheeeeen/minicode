import { commandRegistry } from './index.js';
import type { EffortLevel } from '../../llm/anthropic.js';

commandRegistry.register({
  name: 'exit',
  description: 'Exit the application',
  handler: async (_args, ctx): Promise<void> => {
    ctx.exit();
  }
});

commandRegistry.register({
  name: 'clear',
  description: 'Clear all history and start a new session',
  handler: async (_args, ctx): Promise<void> => {
    ctx.agent.clearSession();
    ctx.agent.setTokenCount(0);
    const newSession = `session-${Date.now()}`;
    const { createLogger } = await import('../../utils/logger.js');
    const newLogger = await createLogger(ctx.sessionManager.getProjectHash(), newSession);
    ctx.agent.setSession(newSession, newLogger);
    ctx.setCurrentSession(newSession);
    ctx.agent.getStore().addStatus({ role: 'status', content: '(Cleared)', timestamp: new Date() });
  }
});

commandRegistry.register({
  name: 'compress',
  description: 'Compress conversation history',
  handler: async (_args, ctx): Promise<void> => {
    await ctx.agent.compress();
    ctx.agent.getStore().addStatus({ role: 'status', content: '(Compression complete)', timestamp: new Date() });
  }
});

commandRegistry.register({
  name: 'effort',
  description: 'Set thinking effort (low|medium|high|xhigh|max)',
  handler: async (args, ctx): Promise<void> => {
    const value = args[0]?.toLowerCase();
    const valid = ['low', 'medium', 'high', 'xhigh', 'max'] as const;
    if (!value || !(valid as readonly string[]).includes(value)) {
      // Show effort selection UI
      ctx.setInputMode('effort-select');
      return;
    }
    ctx.agent.setEffort(value as EffortLevel);
    const { setEffort } = await import('../../config.js');
    await setEffort(value);
    ctx.agent.getStore().addStatus({
      role: 'status',
      content: `(Effort set to: ${value})`,
      timestamp: new Date(),
      
    });
  }
});

commandRegistry.register({
  name: 'new',
  description: 'Create a new session',
  handler: async (args, ctx): Promise<void> => {
    const name = args.join(' ');
    if (name) {
      ctx.agent.clearSession();
      const { createLogger } = await import('../../utils/logger.js');
      const newLogger = await createLogger(ctx.sessionManager.getProjectHash(), name);
      ctx.agent.setSession(name, newLogger);
      ctx.setCurrentSession(name);
      ctx.agent.getStore().addStatus({ role: 'status', content: `Created session: ${name}`, timestamp: new Date() });
    }
  }
});

commandRegistry.register({
  name: 'rename',
  description: 'Rename current session',
  handler: async (args, ctx): Promise<void> => {
    const newName = args.join(' ');
    if (newName) {
      const oldName = ctx.agent.currentSession;
      await ctx.sessionManager.rename(oldName, newName);
      const { createLogger } = await import('../../utils/logger.js');
      const newLogger = await createLogger(ctx.sessionManager.getProjectHash(), newName);
      ctx.agent.setSession(newName, newLogger);
      ctx.setCurrentSession(newName);
      ctx.agent.getStore().addStatus({ role: 'status', content: `Renamed: ${oldName} -> ${newName}`, timestamp: new Date() });
    }
  }
});

commandRegistry.register({
  name: 'resume',
  description: 'Load a session (without args: list sessions)',
  handler: async (args, ctx): Promise<void> => {
    if (args.length === 0) {
      const sessions = await ctx.sessionManager.list();
      ctx.setInputMode('session-list', { sessions });
    } else {
      const name = args[0];
      const data = await ctx.sessionManager.get(name);
      if (data) {
        ctx.agent.setMessages(data.messages as any);
        const totalTokens = data.totalTokens || 0;
        if (totalTokens > 0) {
          ctx.agent.setTokenCount(totalTokens);
        }
        const { createLogger } = await import('../../utils/logger.js');
        const newLogger = await createLogger(ctx.sessionManager.getProjectHash(), name);
        ctx.agent.setSession(name, newLogger);
        ctx.setCurrentSession(name);
        ctx.agent.getStore().addStatus({ role: 'status', content: `Loaded session: ${name}`, timestamp: new Date() });
      } else {
        ctx.agent.getStore().addStatus({ role: 'error', content: `Session not found: ${name}`, timestamp: new Date() });
      }
    }
  }
});

commandRegistry.register({
  name: 'plan',
  description: 'Turn the current discussion into an executable plan',
  prompt: () => {
    return 'Based on our discussion so far, produce a concrete, step-by-step executable plan. For each step, specify what to do and how to verify it works. Do NOT start implementing — only output the plan.';
  }
});

commandRegistry.register({
  name: 'test',
  description: 'Run a simple test across all available tools',
  prompt: () => {
    return 'Run a simple test of all available tools';
  }
});

commandRegistry.register({
  name: 'skills',
  description: 'List available skills',
  handler: async (_args, ctx): Promise<void> => {
    const skillRegistry = ctx.agent.getSkillRegistry();
    if (!skillRegistry) {
      ctx.agent.getStore().addStatus({ role: 'status', content: '(No skill registry available)', timestamp: new Date() });
      return;
    }
    const skills = skillRegistry.getAvailableSkills();
    if (skills.length === 0) {
      ctx.agent.getStore().addStatus({ role: 'status', content: '(No skills available)', timestamp: new Date() });
      return;
    }

    const { createElement: el } = await import('react');
    const { Box, Text } = await import('ink');

    const skillElements = skills.map(skill =>
      el(Box, { key: skill.name, flexDirection: 'row' },
        el(Box, { width: 25 }, el(Text, { color: 'cyan' }, `  /${skill.name}`)),
        el(Box, { flexGrow: 1, flexShrink: 1 }, el(Text, { wrap: 'truncate', dimColor: true }, `- ${skill.description}`))
      )
    );

    const element = el(Box, { flexDirection: 'column', paddingY: 1 },
      el(Text, { bold: true }, 'Available skills:'),
      ...skillElements
    );

    const lines = ['Available skills:'];
    for (const skill of skills) {
      lines.push(`  /${skill.name} - ${skill.description}`);
    }

    ctx.agent.getStore().addStatus({ role: 'status', content: lines.join('\n'), element, timestamp: new Date() });
  }
});
