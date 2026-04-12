/**
 * Skill System Types
 *
 * Defines the shape of skill definitions and their frontmatter metadata.
 * Skills are reusable workflows that can be invoked by name via the `skill` tool.
 */

/** How the skill executes: inline (same session) or fork (delegated agent). */
export type SkillContext = "inline" | "fork";

/** YAML frontmatter fields for a skill .md file. */
export interface SkillFrontmatter {
  description: string;
  when_to_use?: string;
  allowed_tools?: string[];
  model?: string;
  /** Whether the user can invoke this skill directly. Default true. */
  user_invocable?: boolean;
  /** Execution context. Default "inline". */
  context?: SkillContext;
}

/** A fully resolved skill ready for execution. */
export interface SkillDefinition {
  name: string;
  source: "bundled" | "user" | "project";
  frontmatter: SkillFrontmatter;
  body: string;
  filePath?: string;
}
