/**
 * Skill Loader
 *
 * Discovers and loads skills from HLVM's native CC-like layout:
 * 1. Bundled skills
 * 2. User legacy commands  (~/.hlvm/commands/*.md)
 * 3. User skills           (~/.hlvm/skills/<name>/SKILL.md)
 * 4. Project legacy cmds   (<workspace>/.hlvm/commands/*.md)
 * 5. Project skills        (<workspace>/.hlvm/skills/<name>/SKILL.md)
 *
 * Later sources override earlier ones by name, so project skills win over
 * project commands, which win over user skills, and so on.
 *
 * All file I/O via getPlatform().fs.* (SSOT-compliant).
 */

import { ValidationError } from "../../common/error.ts";
import {
  getCommandsDir,
  getProjectCommandsDir,
  getProjectSkillsDir,
  getSkillsDir,
} from "../../common/paths.ts";
import {
  parseFrontmatter,
  splitFrontmatter,
} from "../../common/frontmatter.ts";
import { getPlatform } from "../../platform/platform.ts";
import { isWorkspaceTrusted } from "../prompt/instructions.ts";
import { getBundledSkills } from "./bundled/index.ts";
import type {
  SkillContext,
  SkillDefinition,
  SkillFrontmatter,
  SkillSource,
  SkillSourceKind,
} from "./types.ts";

// ── Session Cache (keyed by workspace) ──────────────────────

let _cacheKey: string | null = null;
let _cachedCatalog: ReadonlyMap<string, SkillDefinition> | null = null;

/** Reset the cached skill catalog. */
export function resetSkillCatalogCache(): void {
  _cacheKey = null;
  _cachedCatalog = null;
}

const SKILL_NAME_REGEX = /^[a-z0-9-]{1,64}$/;
const SUPPORTED_FRONTMATTER_KEYS = new Set([
  "name",
  "description",
  "argument-hint",
  "disable-model-invocation",
  "user-invocable",
  "allowed-tools",
  "context",
]);
const LEGACY_FIELD_ALIASES = new Map<string, string>([
  ["allowed_tools", "allowed-tools"],
  ["argument_hint", "argument-hint"],
  ["user_invocable", "user-invocable"],
  ["when_to_use", "description"],
  ["whenToUse", "description"],
]);
const CC_ALLOWED_TOOL_MAP = new Map<string, string[]>([
  ["Agent", [
    "delegate_agent",
    "batch_delegate",
    "wait_agent",
    "list_agents",
    "close_agent",
    "interrupt_agent",
    "resume_agent",
    "apply_agent_changes",
    "discard_agent_changes",
  ]],
  ["AskUserQuestion", ["ask_user"]],
  ["Bash", ["shell_exec", "shell_script"]],
  ["Edit", ["edit_file"]],
  ["Glob", ["list_files", "get_structure"]],
  ["Grep", ["search_code"]],
  ["Read", ["read_file", "list_files", "file_metadata", "open_path", "reveal_path"]],
  ["Skill", ["Skill", "skill"]],
  ["TaskCreate", ["TaskCreate"]],
  ["TaskGet", ["TaskGet"]],
  ["TaskList", ["TaskList"]],
  ["TaskUpdate", ["TaskUpdate"]],
  ["TodoWrite", ["todo_write"]],
  ["ToolSearch", ["tool_search"]],
  ["WebFetch", ["fetch_url", "web_fetch"]],
  ["WebSearch", ["search_web"]],
  ["Write", [
    "write_file",
    "make_directory",
    "move_path",
    "copy_path",
    "move_to_trash",
    "archive_files",
  ]],
]);

interface LoadCandidate {
  defaultName: string;
  diagnostics: string[];
  filePath: string;
  sourceKind: Exclude<SkillSourceKind, "bundled">;
}

function makeSkillError(message: string): ValidationError {
  return new ValidationError(message, "skills");
}

function assertSupportedFrontmatterKeys(
  meta: Record<string, unknown>,
  filePath: string,
): void {
  for (const key of Object.keys(meta)) {
    const alias = LEGACY_FIELD_ALIASES.get(key);
    if (alias) {
      throw makeSkillError(
        `Unsupported legacy skill field '${key}' in ${filePath}. Use '${alias}' instead.`,
      );
    }
    if (!SUPPORTED_FRONTMATTER_KEYS.has(key)) {
      throw makeSkillError(
        `Unsupported skill field '${key}' in ${filePath}. Supported fields: ${
          [...SUPPORTED_FRONTMATTER_KEYS].join(", ")
        }.`,
      );
    }
  }
}

function parseOptionalString(
  meta: Record<string, unknown>,
  key: string,
  filePath: string,
): string | undefined {
  const value = meta[key];
  if (value === undefined) return undefined;
  if (typeof value !== "string") {
    throw makeSkillError(`Skill field '${key}' in ${filePath} must be a string.`);
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function parseOptionalBoolean(
  meta: Record<string, unknown>,
  key: string,
  filePath: string,
): boolean | undefined {
  const value = meta[key];
  if (value === undefined) return undefined;
  if (typeof value !== "boolean") {
    throw makeSkillError(`Skill field '${key}' in ${filePath} must be a boolean.`);
  }
  return value;
}

function parseAllowedToolsString(value: string): string[] {
  const tokens: string[] = [];
  let current = "";
  let depth = 0;

  for (const char of value.trim()) {
    if (/\s/.test(char) && depth === 0) {
      if (current.trim().length > 0) tokens.push(current.trim());
      current = "";
      continue;
    }
    if (char === "(") depth++;
    if (char === ")" && depth > 0) depth--;
    current += char;
  }

  if (current.trim().length > 0) tokens.push(current.trim());
  return tokens;
}

function translateAllowedToolEntry(entry: string, filePath: string): string[] {
  const trimmed = entry.trim();
  if (!trimmed) return [];

  if (/^[A-Za-z][A-Za-z0-9]*\(.+\)$/.test(trimmed)) {
    throw makeSkillError(
      `Scoped allowed-tools entry '${trimmed}' in ${filePath} cannot be preserved by HLVM. Use bare Claude tool names instead.`,
    );
  }

  const mapped = CC_ALLOWED_TOOL_MAP.get(trimmed);
  if (!mapped) {
    throw makeSkillError(
      `Unsupported allowed-tools entry '${trimmed}' in ${filePath}.`,
    );
  }
  return mapped;
}

function parseAllowedTools(
  meta: Record<string, unknown>,
  filePath: string,
): string[] | undefined {
  const value = meta["allowed-tools"];
  if (value === undefined) return undefined;

  let entries: string[];
  if (typeof value === "string") {
    entries = parseAllowedToolsString(value);
  } else if (Array.isArray(value)) {
    entries = value.map((entry, index) => {
      if (typeof entry !== "string") {
        throw makeSkillError(
          `allowed-tools[${index}] in ${filePath} must be a string.`,
        );
      }
      return entry;
    });
  } else {
    throw makeSkillError(
      `Skill field 'allowed-tools' in ${filePath} must be a string or string array.`,
    );
  }

  const normalized: string[] = [];
  for (const entry of entries) {
    for (const mapped of translateAllowedToolEntry(entry, filePath)) {
      if (!normalized.includes(mapped)) normalized.push(mapped);
    }
  }
  return normalized.length > 0 ? normalized : undefined;
}

function extractFirstParagraph(body: string): string | undefined {
  const paragraphs = body
    .split(/\n\s*\n/)
    .map((paragraph) => paragraph.trim())
    .filter((paragraph) => paragraph.length > 0);

  for (const paragraph of paragraphs) {
    const firstLine = paragraph.split("\n")[0]?.trim() ?? "";
    if (firstLine.startsWith("```")) continue;
    if (/^#{1,6}\s/.test(firstLine) && paragraph.split("\n").length === 1) continue;
    return paragraph.replace(/\s+/g, " ").trim();
  }

  return undefined;
}

function validateSkillName(
  rawName: string,
  filePath: string,
): string {
  const trimmed = rawName.trim();
  if (!SKILL_NAME_REGEX.test(trimmed)) {
    throw makeSkillError(
      `Invalid skill name '${trimmed}' in ${filePath}. Names must use lowercase letters, numbers, and hyphens only (max 64 characters).`,
    );
  }
  return trimmed;
}

function parseContext(
  meta: Record<string, unknown>,
  filePath: string,
): SkillContext {
  const value = parseOptionalString(meta, "context", filePath);
  if (!value) return "inline";
  if (value !== "inline" && value !== "fork") {
    throw makeSkillError(
      `Unsupported skill context '${value}' in ${filePath}. Use 'inline' or 'fork'.`,
    );
  }
  return value;
}

function parseRawFrontmatter(
  text: string,
  filePath: string,
): { body: string; meta: Record<string, unknown> } {
  const { body, frontmatter } = splitFrontmatter(text);
  if (frontmatter === undefined) return { body, meta: {} };
  if (frontmatter.trim().length === 0) return { body, meta: {} };

  const parsed = parseFrontmatter<unknown>(text).meta;
  if (parsed === null) {
    throw makeSkillError(`Invalid YAML frontmatter in ${filePath}.`);
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw makeSkillError(`Frontmatter in ${filePath} must be a YAML object.`);
  }
  return { body, meta: parsed as Record<string, unknown> };
}

function buildNormalizedFrontmatter(
  meta: Record<string, unknown>,
  body: string,
  candidate: LoadCandidate,
): { frontmatter: SkillFrontmatter; name: string } {
  assertSupportedFrontmatterKeys(meta, candidate.filePath);

  const name = validateSkillName(
    parseOptionalString(meta, "name", candidate.filePath) ?? candidate.defaultName,
    candidate.filePath,
  );
  const description = parseOptionalString(meta, "description", candidate.filePath) ??
    extractFirstParagraph(body);
  if (!description) {
    throw makeSkillError(
      `Skill '${name}' in ${candidate.filePath} needs a description or a non-empty first paragraph.`,
    );
  }

  const argumentHint = parseOptionalString(
    meta,
    "argument-hint",
    candidate.filePath,
  );
  const userInvocable = parseOptionalBoolean(
    meta,
    "user-invocable",
    candidate.filePath,
  ) ?? true;
  const disableModelInvocation = parseOptionalBoolean(
    meta,
    "disable-model-invocation",
    candidate.filePath,
  ) ?? false;
  const modelInvocable = !disableModelInvocation;
  if (!userInvocable && !modelInvocable) {
    throw makeSkillError(
      `Skill '${name}' in ${candidate.filePath} is neither user-invocable nor model-invocable.`,
    );
  }

  return {
    name,
    frontmatter: {
      description,
      allowed_tools: parseAllowedTools(meta, candidate.filePath),
      argument_hint: argumentHint,
      user_invocable: userInvocable,
      model_invocable: modelInvocable,
      manual_only: disableModelInvocation,
      context: parseContext(meta, candidate.filePath),
      diagnostics: [...candidate.diagnostics],
    },
  };
}

async function readSkillCandidate(
  candidate: LoadCandidate,
  source: SkillSource,
): Promise<SkillDefinition> {
  const fs = getPlatform().fs;
  let text: string;
  try {
    text = await fs.readTextFile(candidate.filePath);
  } catch {
    throw makeSkillError(`Could not read skill file ${candidate.filePath}.`);
  }

  const { body, meta } = parseRawFrontmatter(text, candidate.filePath);
  const normalized = buildNormalizedFrontmatter(meta, body, candidate);
  return {
    name: normalized.name,
    source,
    sourceKind: candidate.sourceKind,
    frontmatter: normalized.frontmatter,
    body,
    filePath: candidate.filePath,
  };
}

async function loadSkillsFromDir(
  dir: string,
  source: SkillSource,
): Promise<SkillDefinition[]> {
  const fs = getPlatform().fs;
  const pathMod = getPlatform().path;
  const candidates: LoadCandidate[] = [];

  try {
    for await (const entry of fs.readDir(dir)) {
      if (entry.isFile && entry.name.endsWith(".md")) {
        const flatPath = pathMod.join(dir, entry.name);
        const baseName = entry.name.replace(/\.md$/, "");
        throw makeSkillError(
          `Flat skill file '${flatPath}' is not supported. Move it to '${
            pathMod.join(dir, baseName, "SKILL.md")
          }' or '.hlvm/commands/${entry.name}'.`,
        );
      }
      if (!entry.isDirectory) continue;

      const filePath = pathMod.join(dir, entry.name, "SKILL.md");
      try {
        if (!(await fs.exists(filePath))) continue;
      } catch {
        continue;
      }
      candidates.push({
        defaultName: entry.name,
        diagnostics: [],
        filePath,
        sourceKind: "skill",
      });
    }
  } catch (error) {
    if (error instanceof ValidationError) throw error;
    return [];
  }

  const skills: SkillDefinition[] = [];
  for (const candidate of candidates) {
    skills.push(await readSkillCandidate(candidate, source));
  }
  return skills;
}

async function loadLegacyCommandsFromDir(
  dir: string,
  source: SkillSource,
): Promise<SkillDefinition[]> {
  const fs = getPlatform().fs;
  const pathMod = getPlatform().path;
  const candidates: LoadCandidate[] = [];

  try {
    for await (const entry of fs.readDir(dir)) {
      if (!entry.isFile || !entry.name.endsWith(".md")) continue;
      candidates.push({
        defaultName: entry.name.replace(/\.md$/, ""),
        diagnostics: [
          "Loaded from legacy .hlvm/commands path. Migrate to .hlvm/skills/<name>/SKILL.md.",
        ],
        filePath: pathMod.join(dir, entry.name),
        sourceKind: "legacy-command",
      });
    }
  } catch {
    return [];
  }

  const skills: SkillDefinition[] = [];
  for (const candidate of candidates) {
    skills.push(await readSkillCandidate(candidate, source));
  }
  return skills;
}

// ── Catalog Builder ──────────────────────────────────────────

/**
 * Load the full skill catalog.
 *
 * Discovery order (later overrides earlier by name):
 * 1. Bundled skills
 * 2. User legacy commands (~/.hlvm/commands/)
 * 3. User skills (~/.hlvm/skills/)
 * 4. Project legacy commands (<workspace>/.hlvm/commands/) — if trusted
 * 5. Project skills (<workspace>/.hlvm/skills/) — if trusted
 *
 * Results are cached for the session. Call `resetSkillCatalogCache()` to clear.
 */
export async function loadSkillCatalog(
  workspace?: string,
): Promise<ReadonlyMap<string, SkillDefinition>> {
  const key = workspace ?? "";
  if (_cachedCatalog && _cacheKey === key) return _cachedCatalog;

  const catalog = new Map<string, SkillDefinition>();

  for (const skill of getBundledSkills()) {
    catalog.set(skill.name, skill);
  }

  for (const skill of await loadLegacyCommandsFromDir(getCommandsDir(), "user")) {
    catalog.set(skill.name, skill);
  }
  for (const skill of await loadSkillsFromDir(getSkillsDir(), "user")) {
    catalog.set(skill.name, skill);
  }

  if (workspace) {
    const trusted = await isWorkspaceTrusted(workspace);
    if (trusted) {
      for (
        const skill of await loadLegacyCommandsFromDir(
          getProjectCommandsDir(workspace),
          "project",
        )
      ) {
        catalog.set(skill.name, skill);
      }
      for (
        const skill of await loadSkillsFromDir(
          getProjectSkillsDir(workspace),
          "project",
        )
      ) {
        catalog.set(skill.name, skill);
      }
    }
  }

  _cacheKey = key;
  _cachedCatalog = catalog;
  return catalog;
}
