import { skillCreator } from './skill-creator.js';
import type { SkillMeta } from '../services/skill-registry.js';

export const builtinSkills: SkillMeta[] = [
  skillCreator
];