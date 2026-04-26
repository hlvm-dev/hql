import {
  getBundledSkillsDir,
  getUserSkillsDir,
} from "../../../common/paths.ts";
import { parseFrontmatter } from "../../../common/frontmatter.ts";
import { ValidationError } from "../../../common/error.ts";
import { getPlatform } from "../../../platform/platform.ts";
import { getBundledSkillNames, materializeBundledSkills } from "./bundled.ts";
import { isReservedSkillName } from "./reserved.ts";
import type {
  ParsedSkillDefinition,
  SkillDuplicate,
  SkillEntry,
  SkillSnapshot,
  SkillSource,
} from "./types.ts";

export const SKILL_FILE_NAME = "SKILL.md";
const SKILL_NAME_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const MAX_SKILL_NAME_LENGTH = 64;
const MAX_SKILL_DESCRIPTION_LENGTH = 1024;
const MAX_SKILL_COMPATIBILITY_LENGTH = 500;
export const MAX_SKILL_FILE_BYTES = 256 * 1024;
const SKILL_SNAPSHOT_CACHE_TTL_MS = 5_000;

interface SkillRoot {
  dir: string;
  source: SkillSource;
  precedence: number;
  candidateNames?: readonly string[];
  prepare?: () => Promise<void>;
}

interface LoadedSkill {
  entry: SkillEntry;
  precedence: number;
}

interface SkillSnapshotCacheEntry {
  key: string;
  expiresAt: number;
  snapshot: SkillSnapshot;
}

let skillSnapshotCache: SkillSnapshotCacheEntry | null = null;

export function isValidSkillName(name: string): boolean {
  return name.length > 0 &&
    name.length <= MAX_SKILL_NAME_LENGTH &&
    SKILL_NAME_PATTERN.test(name);
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : undefined;
}

function readStringWithMax(
  value: unknown,
  maxLength: number,
): string | undefined {
  const text = readString(value);
  return text && text.length <= maxLength ? text : undefined;
}

function readOptionalStringWithMax(
  value: unknown,
  maxLength: number,
): string | undefined {
  if (value === undefined || value === null) return undefined;
  return readStringWithMax(value, maxLength);
}

function readMetadata(value: unknown): Record<string, string> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  const metadata: Record<string, string> = {};
  for (const [key, entryValue] of Object.entries(value)) {
    if (typeof entryValue === "string") {
      metadata[key] = entryValue;
    }
  }
  return Object.keys(metadata).length > 0 ? metadata : undefined;
}

function readAllowedTools(value: unknown): string[] | undefined {
  const text = readString(value);
  if (!text) return undefined;
  const tools = text.split(/\s+/).filter(Boolean);
  return tools.length > 0 ? tools : undefined;
}

async function readSkillFileIfSafe(path: string): Promise<string | null> {
  const platform = getPlatform();
  const info = await platform.fs.lstat(path);
  if (!info.isFile || info.isSymlink || info.size > MAX_SKILL_FILE_BYTES) {
    return null;
  }
  return await platform.fs.readTextFile(path);
}

export function parseSkillDefinition(
  content: string,
  options: { expectedName?: string } = {},
): ParsedSkillDefinition {
  const { meta } = parseFrontmatter<Record<string, unknown>>(content);
  if (!meta) {
    throw new ValidationError(
      "Skill file must start with YAML frontmatter.",
      "skill",
    );
  }

  const name = readString(meta.name);
  const description = readStringWithMax(
    meta.description,
    MAX_SKILL_DESCRIPTION_LENGTH,
  );
  if (!name) {
    throw new ValidationError("Skill frontmatter is missing `name`.", "skill");
  }
  if (!isValidSkillName(name)) {
    throw new ValidationError(
      "Skill names must be kebab-case, 1-64 chars, using lowercase letters, numbers, and hyphens.",
      "skill",
    );
  }
  if (options.expectedName && name !== options.expectedName) {
    throw new ValidationError(
      `Skill frontmatter name '${name}' must match directory name '${options.expectedName}'.`,
      "skill",
    );
  }
  if (isReservedSkillName(name)) {
    throw new ValidationError(
      `Skill name '${name}' is reserved by a built-in slash command.`,
      "skill",
    );
  }
  if (!description) {
    throw new ValidationError(
      "Skill frontmatter is missing a non-empty `description` under 1024 characters.",
      "skill",
    );
  }

  return {
    name,
    description,
    license: readString(meta.license),
    compatibility: readOptionalStringWithMax(
      meta.compatibility,
      MAX_SKILL_COMPATIBILITY_LENGTH,
    ),
    metadata: readMetadata(meta.metadata),
    allowedTools: readAllowedTools(meta["allowed-tools"]),
  };
}

async function readCandidateSkill(
  root: SkillRoot,
  skillDirName: string,
): Promise<LoadedSkill | null> {
  const platform = getPlatform();
  const skillDir = platform.path.join(root.dir, skillDirName);
  const skillFile = platform.path.join(skillDir, SKILL_FILE_NAME);

  let content: string;
  try {
    const safeContent = await readSkillFileIfSafe(skillFile);
    if (safeContent === null) return null;
    content = safeContent;
  } catch {
    return null;
  }

  let parsed: ParsedSkillDefinition;
  try {
    parsed = parseSkillDefinition(content, { expectedName: skillDirName });
  } catch {
    return null;
  }

  return {
    entry: {
      ...parsed,
      filePath: platform.path.resolve(skillFile),
      baseDir: platform.path.resolve(skillDir),
      source: root.source,
    },
    precedence: root.precedence,
  };
}

async function loadSkillRoot(root: SkillRoot): Promise<LoadedSkill[]> {
  const platform = getPlatform();
  const entries: LoadedSkill[] = [];

  try {
    await root.prepare?.();
    if (root.candidateNames) {
      for (const name of root.candidateNames) {
        const skill = await readCandidateSkill(root, name);
        if (skill) entries.push(skill);
      }
      return entries;
    }

    for await (const entry of platform.fs.readDir(root.dir)) {
      if (!entry.isDirectory) continue;
      if (entry.name.startsWith(".")) continue;
      const skill = await readCandidateSkill(root, entry.name);
      if (skill) entries.push(skill);
    }
  } catch {
    return [];
  }

  return entries;
}

function resolveDuplicates(skills: LoadedSkill[]): SkillSnapshot {
  const byName = new Map<string, LoadedSkill[]>();
  for (const skill of skills) {
    const group = byName.get(skill.entry.name) ?? [];
    group.push(skill);
    byName.set(skill.entry.name, group);
  }

  const winners: SkillEntry[] = [];
  const duplicates: SkillDuplicate[] = [];

  for (const [name, group] of byName) {
    const sorted = group.slice().sort((left, right) => {
      const precedence = right.precedence - left.precedence;
      return precedence !== 0
        ? precedence
        : left.entry.filePath.localeCompare(right.entry.filePath);
    });
    const winner = sorted[0].entry;
    winners.push(winner);
    const shadowed = sorted.slice(1).map((skill) => skill.entry);
    if (shadowed.length > 0) {
      duplicates.push({ name, winner, shadowed });
    }
  }

  winners.sort((left, right) => left.name.localeCompare(right.name));
  duplicates.sort((left, right) => left.name.localeCompare(right.name));
  return { skills: winners, duplicates };
}

function getSkillRoots(): SkillRoot[] {
  const roots: SkillRoot[] = [
    { dir: getUserSkillsDir(), source: "user", precedence: 20 },
    {
      dir: getBundledSkillsDir(),
      source: "bundled",
      precedence: 10,
      candidateNames: getBundledSkillNames(),
      prepare: materializeBundledSkills,
    },
  ];

  return roots;
}

function getSkillSnapshotCacheKey(roots: SkillRoot[]): string {
  return roots.map((root) =>
    [
      root.source,
      root.precedence,
      root.dir,
      root.candidateNames?.join(",") ?? "*",
    ].join(":")
  )
    .join("\n");
}

export function clearSkillSnapshotCache(): void {
  skillSnapshotCache = null;
}

export async function loadSkillSnapshot(): Promise<SkillSnapshot> {
  const roots = getSkillRoots();
  const cacheKey = getSkillSnapshotCacheKey(roots);
  const now = Date.now();
  if (
    skillSnapshotCache?.key === cacheKey &&
    skillSnapshotCache.expiresAt > now
  ) {
    return skillSnapshotCache.snapshot;
  }

  const loaded = await Promise.all(roots.map((root) => loadSkillRoot(root)));
  const snapshot = resolveDuplicates(loaded.flat());
  skillSnapshotCache = {
    key: cacheKey,
    expiresAt: now + SKILL_SNAPSHOT_CACHE_TTL_MS,
    snapshot,
  };
  return snapshot;
}

export async function readSkillBody(entry: SkillEntry): Promise<string> {
  const content = await readSkillFileIfSafe(entry.filePath);
  if (content === null) {
    throw new ValidationError(
      `Skill file is not readable or exceeds ${MAX_SKILL_FILE_BYTES} bytes: ${entry.filePath}`,
      "skill body",
    );
  }
  return parseFrontmatter(content).body;
}

export function findSkillByName(
  snapshot: SkillSnapshot,
  name: string,
): SkillEntry | undefined {
  return snapshot.skills.find((skill) => skill.name === name);
}
