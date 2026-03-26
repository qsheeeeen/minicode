import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import type { ToolDef } from './index.js';

export class ToolRegistry {
  private tools = new Map<string, ToolDef>();

  register(tool: ToolDef): void {
    this.tools.set(tool.name, tool);
  }

  get(name: string): ToolDef | undefined {
    return this.tools.get(name);
  }

  getAll(): ToolDef[] {
    return Array.from(this.tools.values());
  }

  /**
   * Auto-discover tools from a directory.
   * Each tool file should export a default ToolDef or named export matching filename.
   */
  async autoDiscover(directory: string): Promise<void> {
    const absoluteDir = path.resolve(directory);
    try {
      const entries = await fs.readdir(absoluteDir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isFile() && entry.name.endsWith('.ts') && entry.name !== 'index.ts' && entry.name !== 'registry.ts') {
          const moduleName = entry.name.replace('.ts', '');
          try {
            const modulePath = path.join(absoluteDir, entry.name);
            const moduleUrl = `file://${modulePath}`;
            const module = await import(moduleUrl);

            // Try default export first, then named export
            const tool = module.default || module[`${moduleName}Tool`];
            if (tool && tool.name && tool.execute) {
              this.register(tool);
            }
          } catch (e) {
            // Skip modules that fail to load
            console.warn(`Failed to load tool from ${entry.name}: ${(e as Error).message}`);
          }
        }
      }
    } catch (e) {
      // Directory doesn't exist or can't be read
      console.warn(`Cannot discover tools in ${directory}: ${(e as Error).message}`);
    }
  }
}

// Global registry instance
export const toolRegistry = new ToolRegistry();
