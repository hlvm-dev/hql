import { ValidationError } from "../../../common/error.ts";
import { atomicWriteTextFile } from "../../../common/atomic-file.ts";
import { http } from "../../../common/http-client.ts";
import { getPlatform } from "../../../platform/platform.ts";
import {
  installSkillFromGit,
  type SkillInstallOptions,
  type SkillInstallResult,
} from "./install.ts";
import { isReservedSkillName } from "./reserved.ts";
import {
  findSkillByName,
  isValidSkillName,
  loadSkillSnapshot,
} from "./store.ts";
import type { SkillEntry } from "./types.ts";

export const DEFAULT_SKILL_REPOSITORY_INDEX_URL =
  "https://raw.githubusercontent.com/hlvm-dev/skills/main/index.json";

const TEST_INDEX_URL_ENV = "HLVM_TEST_SKILL_INDEX_URL";
const MAX_FILE_INDEX_BYTES = 2 * 1024 * 1024;
const MAX_SKILL_REPOSITORY_ENTRIES = 5000;

export type SkillRepositoryTrust = "official" | "community" | "third-party";

export interface SkillRepositoryEntry {
  slug: string;
  name?: string;
  description: string;
  install: string;
  version?: string;
  versions?: Record<string, string>;
  license?: string;
  tags: string[];
  homepage?: string;
  trust: SkillRepositoryTrust;
  deprecated?: boolean | string;
}

export interface SkillRepositoryIndex {
  version: 1;
  skills: SkillRepositoryEntry[];
}

export interface SkillRepositorySearchOptions {
  query?: string;
  limit?: number;
  indexUrl?: string;
}

export interface SkillRepositoryInstallOptions extends SkillInstallOptions {
  version?: string;
  indexUrl?: string;
}

export interface SkillRepositoryInstallResult {
  entry: SkillRepositoryEntry;
  installed: SkillInstallResult;
}

export interface SkillRepositoryPublishOptions {
  repoDir: string;
  ownerRepo?: string;
  force?: boolean;
  dryRun?: boolean;
}

export interface SkillRepositoryPublishResult {
  entry: SkillRepositoryEntry;
  skillDir: string;
  indexPath: string;
  wrote: boolean;
}

export function isSkillRepositorySlug(value: string): boolean {
  return isValidSkillName(value.trim());
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function readRequiredString(
  value: unknown,
  field: string,
  slugForError?: string,
): string {
  if (typeof value === "string" && value.trim().length > 0) {
    return value.trim();
  }
  const label = slugForError ? ` for "${slugForError}"` : "";
  throw new ValidationError(
    `Skill repository index has invalid ${field}${label}.`,
    "hlvm skill search",
  );
}

function readOptionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : undefined;
}

function readTags(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [
    ...new Set(
      value.filter((tag) => typeof tag === "string" && tag.trim().length > 0)
        .map((tag) => tag.trim()),
    ),
  ];
}

function readVersions(value: unknown): Record<string, string> | undefined {
  if (!isRecord(value)) return undefined;
  const versions: Record<string, string> = {};
  for (const [version, source] of Object.entries(value)) {
    if (
      typeof version === "string" && version.trim().length > 0 &&
      typeof source === "string" && source.trim().length > 0
    ) {
      versions[version.trim()] = source.trim();
    }
  }
  return Object.keys(versions).length > 0 ? versions : undefined;
}

function readTrust(value: unknown): SkillRepositoryTrust {
  if (
    value === "official" || value === "community" || value === "third-party"
  ) {
    return value;
  }
  return "community";
}

function readDeprecated(value: unknown): boolean | string | undefined {
  if (typeof value === "boolean") return value;
  return readOptionalString(value);
}

function normalizeRepositoryEntry(value: unknown): SkillRepositoryEntry {
  if (!isRecord(value)) {
    throw new ValidationError(
      "Skill repository index entries must be objects.",
      "hlvm skill search",
    );
  }
  const slug = readRequiredString(value.slug, "slug");
  if (!isValidSkillName(slug) || isReservedSkillName(slug)) {
    throw new ValidationError(
      `Skill repository index has invalid slug: ${slug}`,
      "hlvm skill search",
    );
  }
  return {
    slug,
    name: readOptionalString(value.name),
    description: readRequiredString(value.description, "description", slug),
    install: readRequiredString(value.install, "install", slug),
    version: readOptionalString(value.version),
    versions: readVersions(value.versions),
    license: readOptionalString(value.license),
    tags: readTags(value.tags),
    homepage: readOptionalString(value.homepage),
    trust: readTrust(value.trust),
    deprecated: readDeprecated(value.deprecated),
  };
}

function normalizeRepositoryIndex(value: unknown): SkillRepositoryIndex {
  if (!isRecord(value) || value.version !== 1 || !Array.isArray(value.skills)) {
    throw new ValidationError(
      "Skill repository index must be { version: 1, skills: [...] }.",
      "hlvm skill search",
    );
  }
  if (value.skills.length > MAX_SKILL_REPOSITORY_ENTRIES) {
    throw new ValidationError(
      `Skill repository index has too many entries (${value.skills.length}).`,
      "hlvm skill search",
    );
  }
  const skills = value.skills.map(normalizeRepositoryEntry);
  const seen = new Set<string>();
  for (const skill of skills) {
    if (seen.has(skill.slug)) {
      throw new ValidationError(
        `Skill repository index has duplicate slug: ${skill.slug}`,
        "hlvm skill search",
      );
    }
    seen.add(skill.slug);
  }
  return { version: 1, skills };
}

function resolveRepositoryIndexUrl(indexUrl?: string): string {
  if (indexUrl?.trim()) return indexUrl.trim();
  const platform = getPlatform();
  if (platform.env.get("HLVM_ALLOW_TEST_STATE_ROOT") === "1") {
    const testIndexUrl = platform.env.get(TEST_INDEX_URL_ENV)?.trim();
    if (testIndexUrl) return testIndexUrl;
  }
  return DEFAULT_SKILL_REPOSITORY_INDEX_URL;
}

async function readFileIndex(url: URL): Promise<unknown> {
  const platform = getPlatform();
  const path = platform.path.fromFileUrl(url);
  const info = await platform.fs.lstat(path);
  if (!info.isFile || info.isSymlink || info.size > MAX_FILE_INDEX_BYTES) {
    throw new ValidationError(
      `Skill repository index must be a regular JSON file under ${MAX_FILE_INDEX_BYTES} bytes.`,
      "hlvm skill search",
    );
  }
  return JSON.parse(await platform.fs.readTextFile(path));
}

export async function loadSkillRepositoryIndex(
  indexUrl?: string,
): Promise<SkillRepositoryIndex> {
  const resolved = resolveRepositoryIndexUrl(indexUrl);
  try {
    const url = new URL(resolved);
    if (url.protocol === "file:") {
      return normalizeRepositoryIndex(await readFileIndex(url));
    }
    if (url.protocol === "https:" || url.protocol === "http:") {
      return normalizeRepositoryIndex(await http.get<unknown>(resolved));
    }
    throw new ValidationError(
      `Unsupported skill repository index URL protocol: ${url.protocol}`,
      "hlvm skill search",
    );
  } catch (err) {
    if (err instanceof ValidationError) throw err;
    throw new ValidationError(
      `Failed to load skill repository index: ${
        err instanceof Error ? err.message : String(err)
      }`,
      "hlvm skill search",
    );
  }
}

function searchText(entry: SkillRepositoryEntry): string {
  return [
    entry.slug,
    entry.name,
    entry.description,
    entry.license,
    entry.trust,
    ...entry.tags,
  ].filter(Boolean).join(" ").toLowerCase();
}

function matchRepositoryEntry(
  entry: SkillRepositoryEntry,
  query: string,
): boolean {
  const normalized = query.trim().toLowerCase();
  if (!normalized || normalized === "*") return true;
  const haystack = searchText(entry);
  return normalized.split(/\s+/).every((token) => haystack.includes(token));
}

function compareSearchResults(
  query: string,
  left: SkillRepositoryEntry,
  right: SkillRepositoryEntry,
): number {
  const normalized = query.trim().toLowerCase();
  if (normalized) {
    const leftExact = left.slug === normalized ? 0 : 1;
    const rightExact = right.slug === normalized ? 0 : 1;
    if (leftExact !== rightExact) return leftExact - rightExact;
    const leftStarts = left.slug.startsWith(normalized) ? 0 : 1;
    const rightStarts = right.slug.startsWith(normalized) ? 0 : 1;
    if (leftStarts !== rightStarts) return leftStarts - rightStarts;
  }
  return left.slug.localeCompare(right.slug);
}

export async function searchSkillRepository(
  options: SkillRepositorySearchOptions = {},
): Promise<SkillRepositoryEntry[]> {
  const limit = options.limit ?? 20;
  if (!Number.isInteger(limit) || limit < 1) {
    throw new ValidationError(
      "Search limit must be a positive integer.",
      "hlvm skill search",
    );
  }
  const index = await loadSkillRepositoryIndex(options.indexUrl);
  return index.skills
    .filter((entry) => matchRepositoryEntry(entry, options.query ?? ""))
    .sort((left, right) =>
      compareSearchResults(options.query ?? "", left, right)
    )
    .slice(0, limit);
}

export async function findSkillRepositoryEntry(
  slug: string,
  options: { indexUrl?: string } = {},
): Promise<SkillRepositoryEntry | null> {
  if (!isSkillRepositorySlug(slug) || isReservedSkillName(slug)) {
    throw new ValidationError(
      `Invalid skill repository slug: ${slug}`,
      "hlvm skill install",
    );
  }
  const index = await loadSkillRepositoryIndex(options.indexUrl);
  return index.skills.find((entry) => entry.slug === slug) ?? null;
}

function resolveInstallSource(
  entry: SkillRepositoryEntry,
  version?: string,
): string {
  if (version?.trim()) {
    const source = entry.versions?.[version.trim()];
    if (!source) {
      throw new ValidationError(
        `Skill "${entry.slug}" has no repository version "${version}".`,
        "hlvm skill install",
      );
    }
    return source;
  }
  return entry.install;
}

export async function installSkillFromRepositorySlug(
  slug: string,
  options: SkillRepositoryInstallOptions = {},
): Promise<SkillRepositoryInstallResult> {
  const entry = await findSkillRepositoryEntry(slug, {
    indexUrl: options.indexUrl,
  });
  if (!entry) {
    throw new ValidationError(
      `Skill not found in repository: ${slug}`,
      "hlvm skill install",
    );
  }
  if (entry.deprecated) {
    throw new ValidationError(
      `Skill "${slug}" is deprecated${
        typeof entry.deprecated === "string" ? `: ${entry.deprecated}` : ""
      }`,
      "hlvm skill install",
    );
  }
  return {
    entry,
    installed: await installSkillFromGit(
      resolveInstallSource(entry, options.version),
      {
        force: options.force,
      },
    ),
  };
}

function requireSafeOwnerRepo(value: string): string {
  const trimmed = value.trim();
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(trimmed)) {
    throw new ValidationError(
      `Invalid owner/repo: ${value}`,
      "hlvm skill publish",
    );
  }
  return trimmed;
}

async function requireRepositoryDir(repoDir: string): Promise<string> {
  const platform = getPlatform();
  const resolved = platform.path.resolve(repoDir);
  const info = await platform.fs.lstat(resolved);
  if (!info.isDirectory || info.isSymlink) {
    throw new ValidationError(
      `Skill repository path must be a real directory: ${repoDir}`,
      "hlvm skill publish",
    );
  }
  return resolved;
}

function buildPublishEntry(
  skill: SkillEntry,
  ownerRepo: string,
): SkillRepositoryEntry {
  if (!skill.license) {
    throw new ValidationError(
      `Skill "${skill.name}" must include license metadata before publishing.`,
      "hlvm skill publish",
    );
  }
  return {
    slug: skill.name,
    name: skill.name,
    description: skill.description,
    install: `github:${ownerRepo}/skills/${skill.name}`,
    version: "1.0.0",
    license: skill.license,
    tags: [],
    trust: ownerRepo === "hlvm-dev/skills" ? "official" : "community",
  };
}

async function copyPublishedSkillTree(
  sourceDir: string,
  targetDir: string,
): Promise<void> {
  const platform = getPlatform();
  await platform.fs.mkdir(targetDir, { recursive: true });
  for await (const entry of platform.fs.readDir(sourceDir)) {
    if (
      entry.name === ".hlvm" || entry.name === ".git" ||
      entry.name === ".DS_Store"
    ) {
      continue;
    }
    const sourcePath = platform.path.join(sourceDir, entry.name);
    const targetPath = platform.path.join(targetDir, entry.name);
    const info = await platform.fs.lstat(sourcePath);
    if (info.isSymlink) {
      throw new ValidationError(
        `Refusing to publish skill with symlink: ${sourcePath}`,
        "hlvm skill publish",
      );
    }
    if (info.isDirectory) {
      await copyPublishedSkillTree(sourcePath, targetPath);
      continue;
    }
    if (info.isFile) {
      await platform.fs.copyFile(sourcePath, targetPath);
    }
  }
}

async function readRepositoryIndexFile(
  indexPath: string,
): Promise<SkillRepositoryIndex> {
  const platform = getPlatform();
  if (!await platform.fs.exists(indexPath)) {
    return { version: 1, skills: [] };
  }
  return normalizeRepositoryIndex(
    JSON.parse(await platform.fs.readTextFile(indexPath)),
  );
}

function upsertRepositoryEntry(
  index: SkillRepositoryIndex,
  entry: SkillRepositoryEntry,
  force: boolean,
): SkillRepositoryIndex {
  const existing = index.skills.find((skill) => skill.slug === entry.slug);
  if (existing && !force) {
    throw new ValidationError(
      `Skill repository already contains "${entry.slug}". Re-run with --force to replace it.`,
      "hlvm skill publish",
    );
  }
  const skills = index.skills
    .filter((skill) => skill.slug !== entry.slug)
    .concat(entry)
    .sort((left, right) => left.slug.localeCompare(right.slug));
  return { version: 1, skills };
}

export async function publishSkillToRepository(
  name: string,
  options: SkillRepositoryPublishOptions,
): Promise<SkillRepositoryPublishResult> {
  if (!isSkillRepositorySlug(name) || isReservedSkillName(name)) {
    throw new ValidationError(
      `Invalid skill name: ${name}`,
      "hlvm skill publish",
    );
  }
  const snapshot = await loadSkillSnapshot();
  const skill = findSkillByName(snapshot, name);
  if (!skill || skill.source !== "user") {
    throw new ValidationError(
      `Only global user skills can be published: ${name}`,
      "hlvm skill publish",
    );
  }

  const platform = getPlatform();
  const repoDir = await requireRepositoryDir(options.repoDir);
  const ownerRepo = requireSafeOwnerRepo(
    options.ownerRepo ?? "hlvm-dev/skills",
  );
  const indexPath = platform.path.join(repoDir, "index.json");
  const skillDir = platform.path.join(repoDir, "skills", skill.name);
  const entry = buildPublishEntry(skill, ownerRepo);

  const nextIndex = upsertRepositoryEntry(
    await readRepositoryIndexFile(indexPath),
    entry,
    options.force === true,
  );
  if (options.dryRun) {
    return { entry, skillDir, indexPath, wrote: false };
  }

  if (options.force && await platform.fs.exists(skillDir)) {
    await platform.fs.remove(skillDir, { recursive: true });
  } else if (await platform.fs.exists(skillDir)) {
    throw new ValidationError(
      `Skill repository already has files at ${skillDir}. Re-run with --force to replace them.`,
      "hlvm skill publish",
    );
  }
  await copyPublishedSkillTree(skill.baseDir, skillDir);
  await atomicWriteTextFile(
    indexPath,
    `${JSON.stringify(nextIndex, null, 2)}\n`,
  );
  return { entry, skillDir, indexPath, wrote: true };
}
