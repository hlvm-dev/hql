/**
 * Skill System Types
 *
 * Defines the normalized shape of skill definitions after CC-style metadata
 * has been validated and translated into HLVM's runtime model.
 */

/** How the skill executes: inline (same session) or fork (child agent). */
export type SkillContext = "inline" | "fork";

/** High-level origin of a normalized skill entry. */
export type SkillSource = "bundled" | "user" | "project";

/** Concrete source shape used to build the skill entry. */
export type SkillSourceKind = "bundled" | "skill" | "legacy-command";

/** Normalized metadata for a skill after validation. */
export interface SkillFrontmatter {
  description: string;
  /** Bundled skills may still provide extra model guidance. */
  when_to_use?: string;
  allowed_tools?: string[];
  argument_hint?: string;
  /** Whether the user can invoke this skill directly via `/name`. */
  user_invocable: boolean;
  /** Whether the model can auto-discover/invoke this skill. */
  model_invocable: boolean;
  /** True when the skill is direct-invocation-only. */
  manual_only: boolean;
  /** Execution context. */
  context: SkillContext;
  /** Non-fatal informational diagnostics attached to the skill. */
  diagnostics: string[];
}

/** A fully resolved skill ready for execution. */
export interface SkillDefinition {
  name: string;
  source: SkillSource;
  sourceKind: SkillSourceKind;
  frontmatter: SkillFrontmatter;
  body: string;
  filePath?: string;
}
