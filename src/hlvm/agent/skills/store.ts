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
  SkillDuplicate,
  SkillEntry,
  SkillSnapshot,
  SkillSource,
} from "./types.ts";

const SKILL_FILE_NAME = "SKILL.md";
const SKILL_NAME_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const MAX_SKILL_NAME_LENGTH = 64;
const MAX_SKILL_FILE_BYTES = 256 * 1024;
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

async function readSkillFileIfSafe(path: string): Promise<string | null> {
  const platform = getPlatform();
  const info = await platform.fs.lstat(path);
  if (!info.isFile || info.isSymlink || info.size > MAX_SKILL_FILE_BYTES) {
    return null;
  }
  return await platform.fs.readTextFile(path);
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

  const { meta } = parseFrontmatter<Record<string, unknown>>(content);
  if (!meta) return null;

  const name = readString(meta.name);
  const description = readString(meta.description);
  if (
    !name || !description || !isValidSkillName(name) ||
    isReservedSkillName(name)
  ) {
    return null;
  }

  return {
    entry: {
      name,
      description,
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
