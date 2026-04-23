import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ToolRegistry } from './registry.js';
import type { ToolDef } from './index.js';

describe('ToolRegistry', () => {
  describe('register', () => {
    it('adds tool to registry', () => {
      const registry = new ToolRegistry();
      const tool: ToolDef = {
        name: 'test',
        description: 'A test tool',
        input_schema: { type: 'object', properties: {} },
        execute: async () => ({ output: 'ok' }),
      };
      registry.register(tool);
      expect(registry.get('test')).toBe(tool);
    });

    it('overwrites existing tool with same name', () => {
      const registry = new ToolRegistry();
      const tool1: ToolDef = {
        name: 'test',
        description: 'Tool 1',
        input_schema: { type: 'object', properties: {} },
        execute: async () => ({ output: 'ok' }),
      };
      const tool2: ToolDef = {
        name: 'test',
        description: 'Tool 2',
        input_schema: { type: 'object', properties: {} },
        execute: async () => ({ output: 'changed' }),
      };
      registry.register(tool1);
      registry.register(tool2);
      expect(registry.get('test')?.description).toBe('Tool 2');
    });
  });

  describe('get', () => {
    it('returns registered tool', () => {
      const registry = new ToolRegistry();
      const tool: ToolDef = {
        name: 'my-tool',
        description: 'Test',
        input_schema: { type: 'object', properties: {} },
        execute: async () => ({ output: 'ok' }),
      };
      registry.register(tool);
      expect(registry.get('my-tool')).toBe(tool);
    });

    it('returns undefined for unknown tool', () => {
      const registry = new ToolRegistry();
      expect(registry.get('nonexistent')).toBeUndefined();
    });
  });

  describe('getAll', () => {
    it('returns all registered tools as array', () => {
      const registry = new ToolRegistry();
      const tool1: ToolDef = {
        name: 'tool1',
        description: 'Tool 1',
        input_schema: { type: 'object', properties: {} },
        execute: async () => ({ output: 'ok' }),
      };
      const tool2: ToolDef = {
        name: 'tool2',
        description: 'Tool 2',
        input_schema: { type: 'object', properties: {} },
        execute: async () => ({ output: 'ok' }),
      };
      registry.register(tool1);
      registry.register(tool2);
      const all = registry.getAll();
      expect(all).toHaveLength(2);
      expect(all.map(t => t.name)).toContain('tool1');
      expect(all.map(t => t.name)).toContain('tool2');
    });

    it('returns empty array when no tools registered', () => {
      const registry = new ToolRegistry();
      expect(registry.getAll()).toEqual([]);
    });
  });
});
