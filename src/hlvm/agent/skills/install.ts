import { getUserSkillsDir } from "../../../common/paths.ts";
import { atomicWriteTextFile } from "../../../common/atomic-file.ts";
import { ValidationError } from "../../../common/error.ts";
import { sha256Hex } from "../../../common/sha256.ts";
import { truncate } from "../../../common/utils.ts";
import { getPlatform } from "../../../platform/platform.ts";
import {
  clearSkillSnapshotCache,
  isValidSkillName,
  loadSkillSnapshot,
  MAX_SKILL_FILE_BYTES,
  parseSkillDefinition,
  SKILL_FILE_NAME,
} from "./store.ts";
import { isReservedSkillName } from "./reserved.ts";
import type { ParsedSkillDefinition } from "./types.ts";

const SKIPPED_COPY_NAMES = new Set([".git", ".clawhub", ".hlvm", ".DS_Store"]);
const MAX_SKILL_TREE_FILE_BYTES = 5 * 1024 * 1024;
const MAX_SKILL_TREE_TOTAL_BYTES = 25 * 1024 * 1024;
const ORIGIN_DIR_NAME = ".hlvm";
const ORIGIN_FILE_NAME = "origin.json";
const MAX_ORIGIN_FILE_BYTES = 32 * 1024;
const MAX_SKILL_DRAFT_GOAL_LENGTH = 4000;

export interface SkillInstallOptions {
  force?: boolean;
}

export interface InstalledSkill {
  name: string;
  targetDir: string;
}

export interface SkillInstallResult {
  installed: InstalledSkill[];
  warnings: string[];
}

export interface SkillCreateResult {
  name: string;
  skillDir: string;
  skillFile: string;
}

export interface SkillDraftOptions {
  force?: boolean;
}

export interface SkillOrigin {
  version: 1;
  source: "authored" | "local" | "git";
  installedAt: number;
  contentHash: string;
  authored?: {
    method: "new" | "draft";
    goal?: string;
  };
  local?: {
    path: string;
  };
  git?: {
    input: string;
    cloneUrl: string;
    ref?: string;
    subpath?: string;
    commit?: string;
  };
}

export interface SkillRemoveResult {
  name: string;
  targetDir: string;
}

export interface SkillUpdateResult {
  name: string;
  targetDir: string;
  changed: boolean;
  previousHash?: string;
  currentHash?: string;
  error?: string;
}

export interface SkillCheckEntry {
  name: string;
  source: "user" | "bundled" | "unknown";
  path: string;
  status: "ready" | "warning" | "error";
  warnings: string[];
  errors: string[];
}

export interface SkillCheckResult {
  total: number;
  ready: number;
  warnings: number;
  errors: number;
  entries: SkillCheckEntry[];
}

interface SkillImportCandidate {
  sourceDir: string;
  definition: ParsedSkillDefinition;
}

interface SkillTreeScan {
  totalBytes: number;
  hasScriptsDir: boolean;
}

interface SkillTreeWalkEntry {
  sourcePath: string;
  relativePath: string;
  info: {
    isFile: boolean;
    isDirectory: boolean;
    isSymlink: boolean;
    size: number;
  };
}

interface GitSkillSource {
  cloneUrl: string;
  ref?: string;
  subpath?: string;
}

interface SkillOriginInput {
  kind: "local" | "git";
  input?: string;
  gitSource?: GitSkillSource;
  commit?: string;
  importRoot?: string;
}

function isPathInside(parent: string, child: string): boolean {
  const platform = getPlatform();
  const relative = platform.path.relative(parent, child);
  return relative === "" ||
    (!relative.startsWith("..") && !platform.path.isAbsolute(relative));
}

function requireUserSkillTarget(name: string): string {
  const platform = getPlatform();
  const userSkillsDir = getUserSkillsDir();
  const targetDir = platform.path.resolve(userSkillsDir, name);
  if (!isPathInside(platform.path.resolve(userSkillsDir), targetDir)) {
    throw new ValidationError(
      `Skill target escapes user skills root: ${name}`,
      "hlvm skill",
    );
  }
  return targetDir;
}

function validateUserSkillName(name: string, command: string): void {
  if (!isValidSkillName(name)) {
    throw new ValidationError(
      "Skill names must be kebab-case, 1-64 chars, using lowercase letters, numbers, and hyphens.",
      command,
    );
  }
  if (isReservedSkillName(name)) {
    throw new ValidationError(
      `Skill name '${name}' is reserved by a built-in slash command.`,
      command,
    );
  }
}

function hasParentPathSegment(path: string): boolean {
  return path.split(/[\\/]+/).some((segment) => segment === "..");
}

function ensureSafeRelativePath(path: string): string {
  const platform = getPlatform();
  if (hasParentPathSegment(path)) {
    throw new ValidationError(
      `Invalid skill install subpath: ${path}`,
      "hlvm skill install",
    );
  }
  const normalized = platform.path.normalize(path);
  if (
    normalized === "." || platform.path.isAbsolute(normalized) ||
    hasParentPathSegment(normalized)
  ) {
    throw new ValidationError(
      `Invalid skill install subpath: ${path}`,
      "hlvm skill install",
    );
  }
  return normalized;
}

function decodeText(bytes: Uint8Array): string {
  return new TextDecoder().decode(bytes).trim();
}

async function readSkillDefinitionFromDir(
  sourceDir: string,
): Promise<ParsedSkillDefinition> {
  const platform = getPlatform();
  const skillFile = platform.path.join(sourceDir, SKILL_FILE_NAME);
  let info;
  try {
    info = await platform.fs.lstat(skillFile);
  } catch {
    throw new ValidationError(
      `No ${SKILL_FILE_NAME} found in ${sourceDir}`,
      "hlvm skill import",
    );
  }
  if (!info.isFile || info.isSymlink || info.size > MAX_SKILL_FILE_BYTES) {
    throw new ValidationError(
      `${SKILL_FILE_NAME} must be a regular file under ${MAX_SKILL_FILE_BYTES} bytes: ${skillFile}`,
      "hlvm skill import",
    );
  }
  return parseSkillDefinition(await platform.fs.readTextFile(skillFile));
}

function getOriginPath(skillDir: string): string {
  const platform = getPlatform();
  return platform.path.join(skillDir, ORIGIN_DIR_NAME, ORIGIN_FILE_NAME);
}

function isSkillOrigin(value: unknown): value is SkillOrigin {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const candidate = value as Partial<SkillOrigin>;
  if (
    candidate.version !== 1 ||
    !["authored", "local", "git"].includes(candidate.source ?? "") ||
    typeof candidate.installedAt !== "number" ||
    typeof candidate.contentHash !== "string"
  ) {
    return false;
  }
  if (candidate.source === "authored") {
    return candidate.authored?.method === "new" ||
      candidate.authored?.method === "draft";
  }
  if (candidate.source === "local") {
    return typeof candidate.local?.path === "string";
  }
  return typeof candidate.git?.input === "string" &&
    typeof candidate.git.cloneUrl === "string";
}

export async function readSkillOrigin(
  skillDir: string,
): Promise<SkillOrigin | null> {
  const platform = getPlatform();
  const originPath = getOriginPath(skillDir);
  try {
    const info = await platform.fs.lstat(originPath);
    if (!info.isFile || info.isSymlink || info.size > MAX_ORIGIN_FILE_BYTES) {
      return null;
    }
    const parsed = JSON.parse(await platform.fs.readTextFile(originPath));
    return isSkillOrigin(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

async function writeSkillOrigin(
  skillDir: string,
  origin: SkillOrigin,
): Promise<void> {
  await atomicWriteTextFile(
    getOriginPath(skillDir),
    `${JSON.stringify(origin, null, 2)}\n`,
  );
}

async function findSkillImportCandidates(
  rawSourcePath: string,
): Promise<SkillImportCandidate[]> {
  const platform = getPlatform();
  const sourcePath = platform.path.resolve(rawSourcePath);
  let sourceInfo;
  try {
    sourceInfo = await platform.fs.lstat(sourcePath);
  } catch {
    throw new ValidationError(
      `Skill source does not exist: ${rawSourcePath}`,
      "hlvm skill import",
    );
  }
  if (!sourceInfo.isDirectory || sourceInfo.isSymlink) {
    throw new ValidationError(
      `Skill source must be a real directory: ${rawSourcePath}`,
      "hlvm skill import",
    );
  }

  const rootSkillFile = platform.path.join(sourcePath, SKILL_FILE_NAME);
  if (await platform.fs.exists(rootSkillFile)) {
    return [{
      sourceDir: sourcePath,
      definition: await readSkillDefinitionFromDir(sourcePath),
    }];
  }

  const candidates: SkillImportCandidate[] = [];
  for await (const entry of platform.fs.readDir(sourcePath)) {
    if (!entry.isDirectory || entry.name.startsWith(".")) continue;
    const childDir = platform.path.join(sourcePath, entry.name);
    const childSkillFile = platform.path.join(childDir, SKILL_FILE_NAME);
    if (!await platform.fs.exists(childSkillFile)) continue;
    candidates.push({
      sourceDir: childDir,
      definition: await readSkillDefinitionFromDir(childDir),
    });
  }

  if (candidates.length === 0) {
    throw new ValidationError(
      `No skills found in ${sourcePath}. Expected ${SKILL_FILE_NAME} or immediate child skill directories.`,
      "hlvm skill import",
    );
  }
  return candidates;
}

function ensureUniqueCandidates(candidates: SkillImportCandidate[]): void {
  const seen = new Set<string>();
  for (const candidate of candidates) {
    const { name } = candidate.definition;
    if (seen.has(name)) {
      throw new ValidationError(
        `Duplicate skill name in import source: ${name}`,
        "hlvm skill import",
      );
    }
    seen.add(name);
  }
}

async function walkSkillTree(
  sourceDir: string,
  visit: (entry: SkillTreeWalkEntry) => void | Promise<void>,
  rootDir = sourceDir,
): Promise<void> {
  const platform = getPlatform();
  const entries: string[] = [];
  for await (const entry of platform.fs.readDir(sourceDir)) {
    if (SKIPPED_COPY_NAMES.has(entry.name)) continue;
    entries.push(entry.name);
  }
  entries.sort((left, right) => left.localeCompare(right));

  for (const name of entries) {
    const sourcePath = platform.path.join(sourceDir, name);
    const info = await platform.fs.lstat(sourcePath);
    const relativePath = platform.path.relative(rootDir, sourcePath);
    await visit({ sourcePath, relativePath, info });
    if (info.isDirectory && !info.isSymlink) {
      await walkSkillTree(sourcePath, visit, rootDir);
    }
  }
}

async function scanSkillTree(sourceDir: string): Promise<SkillTreeScan> {
  const platform = getPlatform();
  const state: SkillTreeScan = { totalBytes: 0, hasScriptsDir: false };
  await walkSkillTree(sourceDir, ({ sourcePath, relativePath, info }) => {
    if (info.isSymlink) {
      throw new ValidationError(
        `Refusing to import skill with symlink: ${sourcePath}`,
        "hlvm skill import",
      );
    }
    if (info.isDirectory) {
      if (
        relativePath === "scripts" ||
        relativePath.startsWith(`scripts${platform.path.sep}`)
      ) {
        state.hasScriptsDir = true;
      }
      return;
    }
    if (!info.isFile) return;
    if (info.size > MAX_SKILL_TREE_FILE_BYTES) {
      throw new ValidationError(
        `Refusing to import oversized skill file: ${sourcePath}`,
        "hlvm skill import",
      );
    }
    state.totalBytes += info.size;
    if (state.totalBytes > MAX_SKILL_TREE_TOTAL_BYTES) {
      throw new ValidationError(
        `Refusing to import skill larger than ${MAX_SKILL_TREE_TOTAL_BYTES} bytes: ${sourceDir}`,
        "hlvm skill import",
      );
    }
  });
  return state;
}

async function collectSkillTreeIssues(
  sourceDir: string,
): Promise<{ totalBytes: number; warnings: string[]; errors: string[] }> {
  const platform = getPlatform();
  const state: { totalBytes: number; warnings: string[]; errors: string[] } = {
    totalBytes: 0,
    warnings: [],
    errors: [],
  };
  await walkSkillTree(sourceDir, ({ sourcePath, relativePath, info }) => {
    if (info.isSymlink) {
      state.errors.push(`Symlink is not allowed: ${sourcePath}`);
      return;
    }
    if (info.isDirectory) {
      if (
        relativePath === "scripts" ||
        relativePath.startsWith(`scripts${platform.path.sep}`)
      ) {
        state.warnings.push(
          "Contains scripts/. HLVM imports files only and does not run install hooks.",
        );
      }
      return;
    }
    if (!info.isFile) return;
    if (info.size > MAX_SKILL_TREE_FILE_BYTES) {
      state.errors.push(`Oversized skill file: ${sourcePath}`);
    }
    state.totalBytes += info.size;
    if (state.totalBytes > MAX_SKILL_TREE_TOTAL_BYTES) {
      state.errors.push(
        `Skill tree exceeds ${MAX_SKILL_TREE_TOTAL_BYTES} bytes: ${sourceDir}`,
      );
    }
  });
  state.warnings = [...new Set(state.warnings)];
  state.errors = [...new Set(state.errors)];
  return state;
}

async function computeSkillTreeHash(skillDir: string): Promise<string> {
  const platform = getPlatform();
  const entries: Array<{ path: string; hash: string }> = [];

  await walkSkillTree(skillDir, async ({ sourcePath, relativePath, info }) => {
    if (info.isSymlink || !info.isFile) return;
    entries.push({
      path: relativePath.split(platform.path.sep).join("/"),
      hash: await sha256Hex(await platform.fs.readFile(sourcePath)),
    });
  });
  return await sha256Hex(
    entries.map((entry) => `${entry.path}\0${entry.hash}`).join("\n"),
  );
}

function joinRelativePath(left?: string, right?: string): string | undefined {
  const platform = getPlatform();
  const parts = [left, right].filter((part): part is string =>
    Boolean(part && part !== ".")
  );
  return parts.length > 0
    ? ensureSafeRelativePath(parts.join(platform.path.sep))
    : undefined;
}

async function buildSkillOrigin(
  candidate: SkillImportCandidate,
  targetDir: string,
  originInput: SkillOriginInput,
): Promise<SkillOrigin> {
  const platform = getPlatform();
  const installedAt = Date.now();
  const contentHash = await computeSkillTreeHash(targetDir);
  if (originInput.kind === "git" && originInput.gitSource) {
    const relativeCandidatePath = originInput.importRoot
      ? platform.path.relative(originInput.importRoot, candidate.sourceDir)
      : undefined;
    return {
      version: 1,
      source: "git",
      installedAt,
      contentHash,
      git: {
        input: originInput.input ?? originInput.gitSource.cloneUrl,
        cloneUrl: originInput.gitSource.cloneUrl,
        ref: originInput.gitSource.ref,
        subpath: joinRelativePath(
          originInput.gitSource.subpath,
          relativeCandidatePath,
        ),
        commit: originInput.commit,
      },
    };
  }

  return {
    version: 1,
    source: "local",
    installedAt,
    contentHash,
    local: {
      path: platform.path.resolve(candidate.sourceDir),
    },
  };
}

async function copySkillTree(
  sourceDir: string,
  targetDir: string,
): Promise<void> {
  const platform = getPlatform();
  await platform.fs.mkdir(targetDir, { recursive: true });
  await walkSkillTree(sourceDir, async ({ sourcePath, relativePath, info }) => {
    const targetPath = platform.path.join(targetDir, relativePath);
    if (info.isSymlink) {
      throw new ValidationError(
        `Refusing to copy symlink from skill source: ${sourcePath}`,
        "hlvm skill import",
      );
    }
    if (info.isDirectory) {
      await platform.fs.mkdir(targetPath, { recursive: true });
      return;
    }
    if (info.isFile) {
      await platform.fs.mkdir(platform.path.dirname(targetPath), {
        recursive: true,
      });
      await platform.fs.copyFile(sourcePath, targetPath);
    }
  });
}

function createStageDirName(skillName: string): string {
  const random = typeof crypto?.randomUUID === "function"
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return `.install-${skillName}-${random}`;
}

function renderSkillScaffold(name: string): string {
  const title = name.split("-").map((part) =>
    part.charAt(0).toUpperCase() + part.slice(1)
  ).join(" ");
  return `---
name: ${name}
description: Use when working on ${name}.
license: MIT
---

# ${title}

Describe when to use this skill and the steps the agent should follow.
`;
}

function quoteYamlString(value: string): string {
  return JSON.stringify(value);
}

function normalizeSkillDraftGoal(goal: string): string {
  return goal.trim().replace(/\s+/g, " ");
}

function formatDraftDescription(goal: string): string {
  const normalized = normalizeSkillDraftGoal(goal).replace(/[.!?]+$/, "");
  const first = normalized.charAt(0).toLowerCase() + normalized.slice(1);
  return truncate(`Use when the agent needs to ${first}.`, 1024, "...");
}

function renderSkillDraft(name: string, goal: string): string {
  const title = name.split("-").map((part) =>
    part.charAt(0).toUpperCase() + part.slice(1)
  ).join(" ");
  const normalizedGoal = normalizeSkillDraftGoal(goal);

  return `---
name: ${name}
description: ${quoteYamlString(formatDraftDescription(normalizedGoal))}
license: MIT
---

# ${title}

Use this skill when the user asks for this workflow:

${normalizedGoal}

## Workflow

1. Restate the concrete request and success condition.
2. Gather only the context needed for this workflow.
3. Execute the smallest reliable sequence of steps.
4. Verify the result through the user-visible path when possible.
5. Report the outcome, verification, and any remaining risk.

## Guardrails

- Do not guess missing facts; ask or inspect when the answer depends on them.
- Do not add background loops, hidden side effects, or product-specific behavior unless the user requested it.
- Do not edit unrelated files or state while applying this skill.
- Keep the final response concise and action-oriented.

## Response Shape

When useful, close with:

- Outcome
- Verified
- Remaining risk
`;
}

function requireSkillDraftGoal(goal: string): string {
  const normalizedGoal = normalizeSkillDraftGoal(goal);
  if (!normalizedGoal) {
    throw new ValidationError(
      "Missing draft goal. Usage: hlvm skill draft <name> <goal...>",
      "hlvm skill draft",
    );
  }
  if (normalizedGoal.length > MAX_SKILL_DRAFT_GOAL_LENGTH) {
    throw new ValidationError(
      `Draft goal must be ${MAX_SKILL_DRAFT_GOAL_LENGTH} characters or less.`,
      "hlvm skill draft",
    );
  }
  return normalizedGoal;
}

export function renderSkillDraftContent(name: string, goal: string): string {
  validateUserSkillName(name, "hlvm skill draft");
  const normalizedGoal = requireSkillDraftGoal(goal);
  const content = renderSkillDraft(name, normalizedGoal);
  parseSkillDefinition(content, { expectedName: name });
  return content;
}

async function writeAuthoredUserSkill(
  name: string,
  content: string,
  authored: NonNullable<SkillOrigin["authored"]>,
  options: SkillDraftOptions,
  command: string,
): Promise<SkillCreateResult> {
  validateUserSkillName(name, command);
  parseSkillDefinition(content, { expectedName: name });

  const platform = getPlatform();
  const userSkillsDir = getUserSkillsDir();
  const skillDir = requireUserSkillTarget(name);
  const skillFile = platform.path.join(skillDir, SKILL_FILE_NAME);

  if (!options.force && await platform.fs.exists(skillDir)) {
    throw new ValidationError(
      `Skill already exists at ${skillDir}`,
      command,
    );
  }

  await platform.fs.mkdir(userSkillsDir, { recursive: true });
  const stageDir = platform.path.join(userSkillsDir, createStageDirName(name));
  const stageFile = platform.path.join(stageDir, SKILL_FILE_NAME);
  try {
    await platform.fs.mkdir(stageDir, { recursive: true });
    await platform.fs.writeTextFile(stageFile, content, { createNew: true });
    await writeSkillOrigin(stageDir, {
      version: 1,
      source: "authored",
      installedAt: Date.now(),
      contentHash: await computeSkillTreeHash(stageDir),
      authored,
    });

    if (options.force && await platform.fs.exists(skillDir)) {
      await platform.fs.remove(skillDir, { recursive: true });
    }
    await platform.fs.rename(stageDir, skillDir);
  } catch (err) {
    try {
      if (await platform.fs.exists(stageDir)) {
        await platform.fs.remove(stageDir, { recursive: true });
      }
    } catch {
      // Best effort: leave any existing target untouched after a failed write.
    }
    throw err;
  }

  clearSkillSnapshotCache();
  return { name, skillDir, skillFile };
}

export async function createUserSkill(
  name: string,
): Promise<SkillCreateResult> {
  return await writeAuthoredUserSkill(
    name,
    renderSkillScaffold(name),
    { method: "new" },
    {},
    "hlvm skill new",
  );
}

export async function draftUserSkill(
  name: string,
  goal: string,
  options: SkillDraftOptions = {},
): Promise<SkillCreateResult> {
  const normalizedGoal = requireSkillDraftGoal(goal);
  return await writeAuthoredUserSkill(
    name,
    renderSkillDraftContent(name, normalizedGoal),
    { method: "draft", goal: normalizedGoal },
    options,
    "hlvm skill draft",
  );
}

export async function importSkillPath(
  sourcePath: string,
  options: SkillInstallOptions = {},
  originInput: SkillOriginInput = { kind: "local" },
): Promise<SkillInstallResult> {
  const platform = getPlatform();
  const candidates = await findSkillImportCandidates(sourcePath);
  ensureUniqueCandidates(candidates);

  const userSkillsDir = getUserSkillsDir();
  await platform.fs.mkdir(userSkillsDir, { recursive: true });

  const targetByName = new Map<string, string>();
  for (const candidate of candidates) {
    const targetDir = requireUserSkillTarget(candidate.definition.name);
    targetByName.set(candidate.definition.name, targetDir);
    if (!options.force && await platform.fs.exists(targetDir)) {
      throw new ValidationError(
        `Skill already exists at ${targetDir}. Re-run with --force to replace it.`,
        "hlvm skill import",
      );
    }
  }

  const warnings: string[] = [];
  const staged: Array<{ name: string; stageDir: string; targetDir: string }> =
    [];
  try {
    for (const candidate of candidates) {
      const scan = await scanSkillTree(candidate.sourceDir);
      if (scan.hasScriptsDir) {
        warnings.push(
          `${candidate.definition.name} contains scripts/. HLVM imports files only and does not run install hooks.`,
        );
      }

      const stageDir = platform.path.join(
        userSkillsDir,
        createStageDirName(candidate.definition.name),
      );
      await copySkillTree(candidate.sourceDir, stageDir);
      await writeSkillOrigin(
        stageDir,
        await buildSkillOrigin(candidate, stageDir, originInput),
      );
      staged.push({
        name: candidate.definition.name,
        stageDir,
        targetDir: targetByName.get(candidate.definition.name)!,
      });
    }

    for (const entry of staged) {
      if (options.force && await platform.fs.exists(entry.targetDir)) {
        await platform.fs.remove(entry.targetDir, { recursive: true });
      }
      await platform.fs.rename(entry.stageDir, entry.targetDir);
    }
  } catch (err) {
    for (const entry of staged) {
      try {
        if (await platform.fs.exists(entry.stageDir)) {
          await platform.fs.remove(entry.stageDir, { recursive: true });
        }
      } catch {
        // Best effort: leave the original target untouched if staging cleanup fails.
      }
    }
    throw err;
  }

  clearSkillSnapshotCache();
  return {
    installed: staged.map(({ name, targetDir }) => ({ name, targetDir })),
    warnings,
  };
}

function parseGitHubSpec(spec: string, ref?: string): GitSkillSource {
  const parts = spec.split("/").filter(Boolean);
  if (parts.length < 2) {
    throw new ValidationError(
      `Invalid GitHub skill source: ${spec}`,
      "hlvm skill install",
    );
  }
  const [owner, repoWithSuffix, ...pathParts] = parts;
  const repo = repoWithSuffix.replace(/\.git$/, "");
  const safeId = /^[A-Za-z0-9_.-]+$/;
  if (!safeId.test(owner) || !safeId.test(repo)) {
    throw new ValidationError(
      `Invalid GitHub repository: ${owner}/${repo}`,
      "hlvm skill install",
    );
  }
  const subpath = pathParts.length > 0
    ? ensureSafeRelativePath(pathParts.join("/"))
    : undefined;
  return {
    cloneUrl: `https://github.com/${owner}/${repo}.git`,
    ref,
    subpath,
  };
}

function stripFragment(input: string): { base: string; fragment?: string } {
  const hashIndex = input.indexOf("#");
  if (hashIndex < 0) return { base: input };
  const fragment = input.slice(hashIndex + 1).trim();
  return {
    base: input.slice(0, hashIndex),
    fragment: fragment.length > 0 ? fragment : undefined,
  };
}

export function parseGitSkillSource(input: string): GitSkillSource {
  const trimmed = input.trim();
  if (!trimmed) {
    throw new ValidationError(
      "Missing git skill source.",
      "hlvm skill install",
    );
  }

  const { base, fragment } = stripFragment(trimmed);
  if (base.startsWith("github:")) {
    return parseGitHubSpec(base.slice("github:".length), fragment);
  }
  if (/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+(?:\/.+)?$/.test(base)) {
    return parseGitHubSpec(base, fragment);
  }

  let url: URL;
  try {
    url = new URL(base);
  } catch {
    throw new ValidationError(
      `Unsupported skill install source: ${input}`,
      "hlvm skill install",
    );
  }

  if (url.hostname === "github.com") {
    const parts = url.pathname.split("/").filter(Boolean);
    if (parts.length >= 4 && parts[2] === "tree") {
      const owner = parts[0];
      const repo = parts[1].replace(/\.git$/, "");
      const ref = fragment ?? parts[3];
      const subpath = parts.length > 4
        ? ensureSafeRelativePath(parts.slice(4).join("/"))
        : undefined;
      return {
        ...parseGitHubSpec(`${owner}/${repo}`, ref),
        subpath,
      };
    }
    if (parts.length >= 2) {
      return parseGitHubSpec(`${parts[0]}/${parts[1]}`, fragment);
    }
  }

  if (!["file:", "https:", "ssh:", "git:"].includes(url.protocol)) {
    throw new ValidationError(
      `Unsupported git URL protocol: ${url.protocol}`,
      "hlvm skill install",
    );
  }
  return {
    cloneUrl: base,
    ref: fragment,
  };
}

async function runGitOutput(cwd: string, args: string[]): Promise<string> {
  const platform = getPlatform();
  const result = await platform.command.output({
    cmd: ["git", ...args],
    cwd,
    stdout: "piped",
    stderr: "piped",
  });
  if (!result.success) {
    const details = decodeText(result.stderr) || decodeText(result.stdout);
    throw new ValidationError(
      `git ${args.join(" ")} failed${details ? `: ${details}` : ""}`,
      "hlvm skill install",
    );
  }
  return decodeText(result.stdout);
}

async function installSkillFromGitSource(
  gitSource: GitSkillSource,
  input: string,
  options: SkillInstallOptions = {},
): Promise<SkillInstallResult> {
  const platform = getPlatform();
  const cloneDir = await platform.fs.makeTempDir({ prefix: "hlvm-skill-git-" });
  try {
    const args = ["clone", "--depth", "1"];
    if (gitSource.ref) {
      args.push("--branch", gitSource.ref);
    }
    args.push(gitSource.cloneUrl, cloneDir);
    let result;
    try {
      result = await platform.command.output({
        cmd: ["git", ...args],
        stdout: "piped",
        stderr: "piped",
      });
    } catch (err) {
      throw new ValidationError(
        `Failed to run git clone: ${
          err instanceof Error ? err.message : String(err)
        }`,
        "hlvm skill install",
      );
    }
    if (!result.success) {
      const details = decodeText(result.stderr) || decodeText(result.stdout);
      throw new ValidationError(
        `git clone failed${details ? `: ${details}` : ""}`,
        "hlvm skill install",
      );
    }

    let commit: string | undefined;
    try {
      commit = await runGitOutput(cloneDir, ["rev-parse", "HEAD"]);
    } catch {
      commit = undefined;
    }

    const importRoot = gitSource.subpath
      ? platform.path.resolve(cloneDir, gitSource.subpath)
      : cloneDir;
    if (!isPathInside(cloneDir, importRoot)) {
      throw new ValidationError(
        `Git skill subpath escapes clone root: ${gitSource.subpath}`,
        "hlvm skill install",
      );
    }
    return await importSkillPath(importRoot, options, {
      kind: "git",
      input,
      gitSource,
      commit,
      importRoot,
    });
  } finally {
    await platform.fs.remove(cloneDir, { recursive: true }).catch(() =>
      undefined
    );
  }
}

export async function installSkillFromGit(
  source: string,
  options: SkillInstallOptions = {},
): Promise<SkillInstallResult> {
  return await installSkillFromGitSource(
    parseGitSkillSource(source),
    source.trim(),
    options,
  );
}

export async function removeSkill(name: string): Promise<SkillRemoveResult> {
  validateUserSkillName(name, "hlvm skill remove");
  const platform = getPlatform();
  const targetDir = requireUserSkillTarget(name);
  if (!await platform.fs.exists(targetDir)) {
    throw new ValidationError(`Skill not found: ${name}`, "hlvm skill remove");
  }
  await platform.fs.remove(targetDir, { recursive: true });
  clearSkillSnapshotCache();
  return { name, targetDir };
}

async function readOriginForUserSkill(
  name: string,
): Promise<{ targetDir: string; origin: SkillOrigin }> {
  validateUserSkillName(name, "hlvm skill update");
  const platform = getPlatform();
  const targetDir = requireUserSkillTarget(name);
  if (!await platform.fs.exists(targetDir)) {
    throw new ValidationError(`Skill not found: ${name}`, "hlvm skill update");
  }
  const origin = await readSkillOrigin(targetDir);
  if (!origin) {
    throw new ValidationError(
      `Skill "${name}" is not tracked. Reinstall or import it before updating.`,
      "hlvm skill update",
    );
  }
  return { targetDir, origin };
}

async function readTrackedUserSkillNames(): Promise<string[]> {
  const platform = getPlatform();
  const userSkillsDir = getUserSkillsDir();
  const names: string[] = [];
  try {
    for await (const entry of platform.fs.readDir(userSkillsDir)) {
      if (!entry.isDirectory || entry.name.startsWith(".")) continue;
      if (!isValidSkillName(entry.name)) continue;
      const targetDir = platform.path.join(userSkillsDir, entry.name);
      const origin = await readSkillOrigin(targetDir);
      if (origin?.source === "git" || origin?.source === "local") {
        names.push(entry.name);
      }
    }
  } catch {
    return [];
  }
  return names.sort((left, right) => left.localeCompare(right));
}

async function updateSingleSkill(name: string): Promise<SkillUpdateResult> {
  try {
    const { targetDir, origin } = await readOriginForUserSkill(name);
    const previousHash = origin.contentHash;
    const installedHash = await computeSkillTreeHash(targetDir);
    let result: SkillInstallResult;
    if (origin.source === "git" && origin.git) {
      result = await installSkillFromGitSource(
        {
          cloneUrl: origin.git.cloneUrl,
          ref: origin.git.ref,
          subpath: origin.git.subpath,
        },
        origin.git.input,
        { force: true },
      );
    } else if (origin.source === "local" && origin.local) {
      result = await importSkillPath(origin.local.path, { force: true });
    } else if (origin.source === "authored") {
      throw new ValidationError(
        `Skill "${name}" is user-authored and has no update source.`,
        "hlvm skill update",
      );
    } else {
      throw new ValidationError(
        `Skill "${name}" has invalid origin metadata.`,
        "hlvm skill update",
      );
    }
    const installed = result.installed.find((skill) => skill.name === name);
    if (!installed) {
      throw new ValidationError(
        `Update source did not produce skill "${name}".`,
        "hlvm skill update",
      );
    }
    const updatedOrigin = await readSkillOrigin(installed.targetDir);
    const currentHash = updatedOrigin?.contentHash ??
      await computeSkillTreeHash(installed.targetDir);
    return {
      name,
      targetDir: installed.targetDir,
      changed: previousHash !== currentHash || installedHash !== currentHash,
      previousHash,
      currentHash,
    };
  } catch (err) {
    return {
      name,
      targetDir: requireUserSkillTarget(name),
      changed: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function updateSkills(
  target: { name: string } | { all: true },
): Promise<SkillUpdateResult[]> {
  if ("name" in target) {
    const result = await updateSingleSkill(target.name);
    if (result.error) {
      throw new ValidationError(result.error, "hlvm skill update");
    }
    return [result];
  }
  const names = await readTrackedUserSkillNames();
  const results: SkillUpdateResult[] = [];
  for (const name of names) {
    results.push(await updateSingleSkill(name));
  }
  return results;
}

async function checkUserSkillDir(
  name: string,
  targetDir: string,
): Promise<SkillCheckEntry> {
  const platform = getPlatform();
  const warnings: string[] = [];
  const errors: string[] = [];
  const skillFile = platform.path.join(targetDir, SKILL_FILE_NAME);

  try {
    const dirInfo = await platform.fs.lstat(targetDir);
    if (!dirInfo.isDirectory || dirInfo.isSymlink) {
      errors.push("Skill entry is not a real directory.");
    }
  } catch {
    errors.push("Skill directory is not readable.");
  }

  let parsed: ParsedSkillDefinition | null = null;
  try {
    const info = await platform.fs.lstat(skillFile);
    if (!info.isFile || info.isSymlink) {
      errors.push(`${SKILL_FILE_NAME} is not a regular file.`);
    } else if (info.size > MAX_SKILL_FILE_BYTES) {
      errors.push(`${SKILL_FILE_NAME} exceeds ${MAX_SKILL_FILE_BYTES} bytes.`);
    } else {
      parsed = parseSkillDefinition(
        await platform.fs.readTextFile(skillFile),
        { expectedName: name },
      );
    }
  } catch (err) {
    errors.push(
      err instanceof ValidationError
        ? err.message
        : `Missing or unreadable ${SKILL_FILE_NAME}.`,
    );
  }

  try {
    const tree = await collectSkillTreeIssues(targetDir);
    warnings.push(...tree.warnings);
    errors.push(...tree.errors);
  } catch {
    errors.push("Skill tree is not readable.");
  }

  const origin = await readSkillOrigin(targetDir);
  if (!origin) {
    warnings.push("No origin metadata; update cannot track this skill.");
  } else if (origin.source !== "authored") {
    const currentHash = await computeSkillTreeHash(targetDir);
    if (currentHash !== origin.contentHash) {
      warnings.push("Local files differ from recorded install hash.");
    }
  }
  if (parsed && !parsed.license) {
    warnings.push("Missing license metadata.");
  }

  const uniqueWarnings = [...new Set(warnings)];
  const uniqueErrors = [...new Set(errors)];
  return {
    name,
    source: "user",
    path: skillFile,
    status: uniqueErrors.length > 0
      ? "error"
      : uniqueWarnings.length > 0
      ? "warning"
      : "ready",
    warnings: uniqueWarnings,
    errors: uniqueErrors,
  };
}

export async function checkSkills(): Promise<SkillCheckResult> {
  const platform = getPlatform();
  const entries: SkillCheckEntry[] = [];
  const userSkillsDir = getUserSkillsDir();

  try {
    for await (const entry of platform.fs.readDir(userSkillsDir)) {
      if (entry.name.startsWith(".")) continue;
      if (!entry.isDirectory) continue;
      const targetDir = platform.path.join(userSkillsDir, entry.name);
      entries.push(await checkUserSkillDir(entry.name, targetDir));
    }
  } catch {
    // No user skills directory yet.
  }

  const bundled = await loadSkillSnapshot();
  const userNames = new Set(entries.map((entry) => entry.name));
  for (const skill of bundled.skills) {
    if (skill.source !== "bundled" || userNames.has(skill.name)) continue;
    entries.push({
      name: skill.name,
      source: "bundled",
      path: skill.filePath,
      status: "ready",
      warnings: [],
      errors: [],
    });
  }

  entries.sort((left, right) => left.name.localeCompare(right.name));
  const ready = entries.filter((entry) => entry.status === "ready").length;
  const warnings = entries.filter((entry) => entry.status === "warning").length;
  const errors = entries.filter((entry) => entry.status === "error").length;
  return {
    total: entries.length,
    ready,
    warnings,
    errors,
    entries,
  };
}
