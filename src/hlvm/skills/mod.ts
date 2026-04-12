/**
 * Skills Module — Barrel Export
 *
 * Reusable workflow skills that can be invoked by name via the `skill` tool.
 */

export type {
  SkillDefinition,
  SkillFrontmatter,
} from "./types.ts";
export { loadSkillCatalog, resetSkillCatalogCache } from "./loader.ts";
export { executeInlineSkill } from "./executor.ts";
