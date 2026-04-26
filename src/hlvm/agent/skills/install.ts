import { getUserSkillsDir } from "../../../common/paths.ts";
import { ValidationError } from "../../../common/error.ts";
import { getPlatform } from "../../../platform/platform.ts";
import {
  clearSkillSnapshotCache,
  MAX_SKILL_FILE_BYTES,
  parseSkillDefinition,
  SKILL_FILE_NAME,
} from "./store.ts";
import type { ParsedSkillDefinition } from "./types.ts";

const SKIPPED_COPY_NAMES = new Set([".git", ".clawhub", ".hlvm", ".DS_Store"]);
const MAX_SKILL_TREE_FILE_BYTES = 5 * 1024 * 1024;
const MAX_SKILL_TREE_TOTAL_BYTES = 25 * 1024 * 1024;

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

interface SkillImportCandidate {
  sourceDir: string;
  definition: ParsedSkillDefinition;
}

interface SkillTreeScan {
  totalBytes: number;
  hasScriptsDir: boolean;
}

interface GitSkillSource {
  cloneUrl: string;
  ref?: string;
  subpath?: string;
}

function isPathInside(parent: string, child: string): boolean {
  const platform = getPlatform();
  const relative = platform.path.relative(parent, child);
  return relative === "" ||
    (!relative.startsWith("..") && !platform.path.isAbsolute(relative));
}

function ensureSafeRelativePath(path: string): string {
  const platform = getPlatform();
  if (path.split(/[\\/]+/).some((segment) => segment === "..")) {
    throw new ValidationError(
      `Invalid skill install subpath: ${path}`,
      "hlvm skill install",
    );
  }
  const normalized = platform.path.normalize(path);
  if (
    normalized === "." || platform.path.isAbsolute(normalized) ||
    normalized.split(/[\\/]+/).some((segment) => segment === "..")
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

async function scanSkillTree(
  sourceDir: string,
  rootDir = sourceDir,
  state: SkillTreeScan = { totalBytes: 0, hasScriptsDir: false },
): Promise<SkillTreeScan> {
  const platform = getPlatform();
  for await (const entry of platform.fs.readDir(sourceDir)) {
    if (SKIPPED_COPY_NAMES.has(entry.name)) continue;
    const sourcePath = platform.path.join(sourceDir, entry.name);
    const info = await platform.fs.lstat(sourcePath);
    if (info.isSymlink) {
      throw new ValidationError(
        `Refusing to import skill with symlink: ${sourcePath}`,
        "hlvm skill import",
      );
    }
    if (info.isDirectory) {
      const relative = platform.path.relative(rootDir, sourcePath);
      if (
        relative === "scripts" ||
        relative.startsWith(`scripts${platform.path.sep}`)
      ) {
        state.hasScriptsDir = true;
      }
      await scanSkillTree(sourcePath, rootDir, state);
      continue;
    }
    if (!info.isFile) continue;
    if (info.size > MAX_SKILL_TREE_FILE_BYTES) {
      throw new ValidationError(
        `Refusing to import oversized skill file: ${sourcePath}`,
        "hlvm skill import",
      );
    }
    state.totalBytes += info.size;
    if (state.totalBytes > MAX_SKILL_TREE_TOTAL_BYTES) {
      throw new ValidationError(
        `Refusing to import skill larger than ${MAX_SKILL_TREE_TOTAL_BYTES} bytes: ${rootDir}`,
        "hlvm skill import",
      );
    }
  }
  return state;
}

async function copySkillTree(
  sourceDir: string,
  targetDir: string,
): Promise<void> {
  const platform = getPlatform();
  await platform.fs.mkdir(targetDir, { recursive: true });
  for await (const entry of platform.fs.readDir(sourceDir)) {
    if (SKIPPED_COPY_NAMES.has(entry.name)) continue;
    const sourcePath = platform.path.join(sourceDir, entry.name);
    const targetPath = platform.path.join(targetDir, entry.name);
    const info = await platform.fs.lstat(sourcePath);
    if (info.isSymlink) {
      throw new ValidationError(
        `Refusing to copy symlink from skill source: ${sourcePath}`,
        "hlvm skill import",
      );
    }
    if (info.isDirectory) {
      await copySkillTree(sourcePath, targetPath);
      continue;
    }
    if (info.isFile) {
      await platform.fs.copyFile(sourcePath, targetPath);
    }
  }
}

function createStageDirName(skillName: string): string {
  const random = typeof crypto?.randomUUID === "function"
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return `.install-${skillName}-${random}`;
}

export async function importSkillPath(
  sourcePath: string,
  options: SkillInstallOptions = {},
): Promise<SkillInstallResult> {
  const platform = getPlatform();
  const candidates = await findSkillImportCandidates(sourcePath);
  ensureUniqueCandidates(candidates);

  const userSkillsDir = getUserSkillsDir();
  await platform.fs.mkdir(userSkillsDir, { recursive: true });

  const targetByName = new Map<string, string>();
  for (const candidate of candidates) {
    const targetDir = platform.path.join(
      userSkillsDir,
      candidate.definition.name,
    );
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

export async function installSkillFromGit(
  source: string,
  options: SkillInstallOptions = {},
): Promise<SkillInstallResult> {
  const platform = getPlatform();
  const gitSource = parseGitSkillSource(source);
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

    const importRoot = gitSource.subpath
      ? platform.path.resolve(cloneDir, gitSource.subpath)
      : cloneDir;
    if (!isPathInside(cloneDir, importRoot)) {
      throw new ValidationError(
        `Git skill subpath escapes clone root: ${gitSource.subpath}`,
        "hlvm skill install",
      );
    }
    return await importSkillPath(importRoot, options);
  } finally {
    await platform.fs.remove(cloneDir, { recursive: true }).catch(() =>
      undefined
    );
  }
}
