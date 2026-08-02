import type { SkillRegistry } from "./index.js";

/**
 * SkillManager — owns the skill loading lifecycle for a SkillRegistry.
 * Pure core-layer concern: it scans directories; command wiring (which is a
 * UI concern) happens at the composition root, not here.
 */
export class SkillManager {
  private dirs: string[] = [];

  constructor(private registry: SkillRegistry) {}

  /** Add a directory to scan for skills (each subdir with SKILL.md). */
  addDirectory(dir: string): this {
    this.dirs.push(dir);
    return this;
  }

  /** Load skills from all added directories into the injected registry. */
  async loadAll(): Promise<void> {
    for (const dir of this.dirs) {
      await this.registry.loadDirectory(dir);
    }
  }

  getRegistry(): SkillRegistry {
    return this.registry;
  }
}
