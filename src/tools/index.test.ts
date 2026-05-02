import { describe, it, expect } from 'vitest';
import { ToolRegistry } from './registry.js';
import { registerTools, allTools } from './index.js';
import type { ToolAvailability } from './index.js';

describe('registerTools', () => {
  const fullAvailability: ToolAvailability = {
    agentRegistry: {} as any,
    skillRegistry: { getSkillBody: () => '' } as any,
  };

  it('registers all tools when no exclusions and all requirements met', () => {
    const registry = new ToolRegistry();
    registerTools(registry, fullAvailability);
    const names = registry.getAll().map(t => t.name);
    for (const tool of allTools) {
      expect(names).toContain(tool.name);
    }
  });

  it('skips excluded tools', () => {
    const registry = new ToolRegistry();
    registerTools(registry, fullAvailability, ['Bash']);
    const names = registry.getAll().map(t => t.name);
    expect(names).not.toContain('Bash');
    expect(names).toContain('Read');
  });

  it('skips multiple excluded tools', () => {
    const registry = new ToolRegistry();
    registerTools(registry, fullAvailability, ['Bash', 'Read', 'Write']);
    const names = registry.getAll().map(t => t.name);
    expect(names).not.toContain('Bash');
    expect(names).not.toContain('Read');
    expect(names).not.toContain('Write');
  });

  it('skips tools whose requirements are not met', () => {
    const registry = new ToolRegistry();
    const noAgent: ToolAvailability = {
      agentRegistry: undefined,
      skillRegistry: {} as any,
    };
    registerTools(registry, noAgent);
    const names = registry.getAll().map(t => t.name);
    const toolsNeedingAgent = allTools
      .filter(t => t.requires?.includes('agentRegistry'))
      .map(t => t.name);
    for (const name of toolsNeedingAgent) {
      expect(names).not.toContain(name);
    }
  });

  it('registers tools when their requirements are met', () => {
    const registry = new ToolRegistry();
    registerTools(registry, fullAvailability);
    const names = registry.getAll().map(t => t.name);
    const toolsNeedingAgent = allTools
      .filter(t => t.requires?.includes('agentRegistry'))
      .map(t => t.name);
    for (const name of toolsNeedingAgent) {
      expect(names).toContain(name);
    }
  });

  it('skips tools missing skillRegistry', () => {
    const registry = new ToolRegistry();
    const noSkills: ToolAvailability = {
      agentRegistry: {} as any,
      skillRegistry: undefined,
    };
    registerTools(registry, noSkills);
    const names = registry.getAll().map(t => t.name);
    const toolsNeedingSkills = allTools
      .filter(t => t.requires?.includes('skillRegistry'))
      .map(t => t.name);
    for (const name of toolsNeedingSkills) {
      expect(names).not.toContain(name);
    }
  });
});
