/**
 * Skill Loader
 *
 * Discovers and loads skills from three sources (in priority order):
 * 1. Bundled — built-in skills shipped with HLVM
 * 2. User — ~/.hlvm/skills/*.md
 * 3. Project — <workspace>/.hlvm/skills/*.md (trust-gated)
 *
 * Later sources override earlier ones by name, so a user skill can shadow
 * a bundled skill, and a project skill can shadow both.
 *
 * All file I/O via getPlatform().fs.* (SSOT-compliant).
 */

import { parseFrontmatter } from "../../common/frontmatter.ts";
import { getPlatform } from "../../platform/platform.ts";
import { getProjectSkillsDir, getSkillsDir } from "../../common/paths.ts";
import { isWorkspaceTrusted } from "../prompt/instructions.ts";
import { getBundledSkills } from "./bundled/index.ts";
import type { SkillDefinition } from "./types.ts";

// ── Session Cache ────────────────────────────────────────────

let _cachedCatalog: ReadonlyMap<string, SkillDefinition> | null = null;

/** Reset the cached skill catalog (for tests). */
export function resetSkillCatalogCache(): void {
  _cachedCatalog = null;
}

// ── Directory Loader ─────────────────────────────────────────

/**
 * Load skill definitions from .md files in a directory.
 * Each file must have YAML frontmatter with at least a `description` field.
 * Files without valid frontmatter are silently skipped.
 */
async function loadSkillsFromDir(
  dir: string,
  source: "user" | "project",
): Promise<SkillDefinition[]> {
  const fs = getPlatform().fs;
  const pathMod = getPlatform().path;
  const skills: SkillDefinition[] = [];

  try {
    for await (const entry of fs.readDir(dir)) {
      if (!entry.isFile || !entry.name.endsWith(".md")) continue;

      const filePath = pathMod.join(dir, entry.name);
      let text: string;
      try {
        text = await fs.readTextFile(filePath);
      } catch {
        continue; // Unreadable file — skip
      }

      const { meta, body } = parseFrontmatter<Record<string, unknown>>(text);
      if (!meta || typeof meta.description !== "string") continue;

      const name = entry.name.replace(/\.md$/, "");
      skills.push({
        name,
        source,
        frontmatter: {
          description: meta.description,
          when_to_use: typeof meta.when_to_use === "string" ? meta.when_to_use : undefined,
          allowed_tools: Array.isArray(meta.allowed_tools) ? meta.allowed_tools.filter((t): t is string => typeof t === "string") : undefined,
          model: typeof meta.model === "string" ? meta.model : undefined,
          user_invocable: typeof meta.user_invocable === "boolean" ? meta.user_invocable : undefined,
          context: meta.context === "inline" || meta.context === "fork" ? meta.context : undefined,
        },
        body,
        filePath,
      });
    }
  } catch {
    // Directory doesn't exist or isn't readable — return empty
  }

  return skills;
}

// ── Catalog Builder ──────────────────────────────────────────

/**
 * Load the full skill catalog.
 *
 * Discovery order (later overrides earlier by name):
 * 1. Bundled skills
 * 2. User skills (~/.hlvm/skills/)
 * 3. Project skills (<workspace>/.hlvm/skills/) — only if workspace is trusted
 *
 * Results are cached for the session. Call `resetSkillCatalogCache()` to clear.
 */
export async function loadSkillCatalog(
  workspace?: string,
): Promise<ReadonlyMap<string, SkillDefinition>> {
  if (_cachedCatalog) return _cachedCatalog;

  const catalog = new Map<string, SkillDefinition>();

  // 1. Bundled skills
  for (const skill of getBundledSkills()) {
    catalog.set(skill.name, skill);
  }

  // 2. User skills
  const userSkills = await loadSkillsFromDir(getSkillsDir(), "user");
  for (const skill of userSkills) {
    catalog.set(skill.name, skill);
  }

  // 3. Project skills (trust-gated)
  if (workspace) {
    const trusted = await isWorkspaceTrusted(workspace);
    if (trusted) {
      const projectSkills = await loadSkillsFromDir(
        getProjectSkillsDir(workspace),
        "project",
      );
      for (const skill of projectSkills) {
        catalog.set(skill.name, skill);
      }
    }
  }

  _cachedCatalog = catalog;
  return catalog;
}
