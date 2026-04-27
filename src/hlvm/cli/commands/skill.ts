import { log } from "../../api/log.ts";
import { ValidationError } from "../../../common/error.ts";
import { truncate } from "../../../common/utils.ts";
import {
  checkSkills,
  createUserSkill,
  draftUserSkill,
  importSkillPath,
  installSkillFromGit,
  readSkillOrigin,
  removeSkill,
  renderSkillDraftContent,
  type SkillCheckResult,
  type SkillInstallResult,
  type SkillOrigin,
  type SkillUpdateResult,
  updateSkills,
} from "../../agent/skills/install.ts";
import {
  findSkillRepositoryEntry,
  installSkillFromRepositorySlug,
  isSkillRepositorySlug,
  searchSkillRepository,
  type SkillRepositoryEntry,
} from "../../agent/skills/repository.ts";
import {
  findSkillByName,
  isValidSkillName,
  loadSkillSnapshot,
  readSkillBody,
} from "../../agent/skills/store.ts";
import { isReservedSkillName } from "../../agent/skills/reserved.ts";
import type { SkillEntry } from "../../agent/skills/types.ts";
import { hasHelpFlag } from "../utils/common-helpers.ts";

const BODY_PREVIEW_LINES = 40;

export function showSkillHelp(): void {
  log.raw.log(`
HLVM Skills - Portable procedural knowledge for agents

Usage: hlvm skill <command> [options]

Commands:
  list                  List available skills
  new <name>            Create a global user skill
  draft <name> <goal>   Draft a global user skill from a workflow goal
  search [query]        Search the official HLVM skill repository
  info <name>           Show local or remote skill metadata
  import <path>         Import a local skill folder or skill pack
  install <source>      Install by repository slug or Git/GitHub source
  update <name|--all>   Update tracked user skills
  remove <name>         Remove a global user skill
  check [--json]        Validate installed skills

Examples:
  hlvm skill list
  hlvm skill new debug-workflow
  hlvm skill draft debug-hang "Diagnose hlvm ask hangs after tool output"
  hlvm skill search debug
  hlvm skill install debug-workflow
  hlvm skill info debug-workflow
  hlvm skill info debug-workflow --remote
  hlvm skill import ./debug-workflow
  hlvm skill install github:owner/repo/path/to/skill
  hlvm skill update debug-workflow
  hlvm skill update --all
  hlvm skill remove debug-workflow
  hlvm skill check
`);
}

function pad(text: string, width: number): string {
  if (text.length >= width) return truncate(text, width, "…");
  return text.padEnd(width);
}

function parseSkillName(raw: string | undefined, usage: string): string {
  if (!raw) {
    throw new ValidationError(`Missing skill name. Usage: ${usage}`, usage);
  }
  const name = raw.trim();
  if (!isValidSkillName(name)) {
    throw new ValidationError(
      "Skill names must be kebab-case, 1-64 chars, using lowercase letters, numbers, and hyphens.",
      usage,
    );
  }
  if (isReservedSkillName(name)) {
    throw new ValidationError(
      `Skill name '${name}' is reserved by a built-in slash command.`,
      usage,
    );
  }
  return name;
}

export async function skillCommand(args: string[]): Promise<void | number> {
  if (args.length === 0 || hasHelpFlag(args)) {
    showSkillHelp();
    return;
  }

  const subcommand = args[0];
  const subArgs = args.slice(1);
  switch (subcommand) {
    case "list":
    case "ls":
      if (hasHelpFlag(subArgs)) {
        showSkillHelp();
        return;
      }
      return await skillList();
    case "new":
      if (hasHelpFlag(subArgs)) {
        showSkillHelp();
        return;
      }
      return await skillNew(subArgs);
    case "draft":
      if (hasHelpFlag(subArgs)) {
        showSkillHelp();
        return;
      }
      return await skillDraft(subArgs);
    case "search":
      if (hasHelpFlag(subArgs)) {
        showSkillHelp();
        return;
      }
      return await skillSearch(subArgs);
    case "info":
      if (hasHelpFlag(subArgs)) {
        showSkillHelp();
        return;
      }
      return await skillInfo(subArgs);
    case "import":
      if (hasHelpFlag(subArgs)) {
        showSkillHelp();
        return;
      }
      return await skillImport(subArgs);
    case "install":
      if (hasHelpFlag(subArgs)) {
        showSkillHelp();
        return;
      }
      return await skillInstall(subArgs);
    case "update":
      if (hasHelpFlag(subArgs)) {
        showSkillHelp();
        return;
      }
      return await skillUpdate(subArgs);
    case "remove":
    case "rm":
      if (hasHelpFlag(subArgs)) {
        showSkillHelp();
        return;
      }
      return await skillRemove(subArgs);
    case "check":
    case "audit":
      if (hasHelpFlag(subArgs)) {
        showSkillHelp();
        return;
      }
      return await skillCheck(subArgs);
    default:
      throw new ValidationError(
        `Unknown skill command: ${subcommand}. Run 'hlvm skill --help' for usage.`,
        "skill",
      );
  }
}

async function skillList(): Promise<void> {
  const snapshot = await loadSkillSnapshot();
  if (snapshot.skills.length === 0) {
    log.raw.log("No skills found.");
    log.raw.log("Create one with `hlvm skill new <name>`.");
    return;
  }

  const nameWidth = 24;
  const sourceWidth = 8;
  log.raw.log(
    `${pad("NAME", nameWidth)}  ${pad("SOURCE", sourceWidth)}  DESCRIPTION`,
  );
  for (const skill of snapshot.skills) {
    log.raw.log(
      `${pad(skill.name, nameWidth)}  ${
        pad(skill.source, sourceWidth)
      }  ${skill.description}`,
    );
  }

  if (snapshot.duplicates.length > 0) {
    log.raw.log("");
    for (const duplicate of snapshot.duplicates) {
      const shadowed = duplicate.shadowed
        .map((skill) => `${skill.source}:${skill.filePath}`)
        .join(", ");
      log.raw.log(
        `Shadowed ${duplicate.name}: using ${
          formatSkillRef(duplicate.winner)
        } over ${shadowed}`,
      );
    }
  }
}

function formatSkillRef(skill: SkillEntry): string {
  return `${skill.source}:${skill.filePath}`;
}

interface SkillNewOptions {
  name: string;
}

interface SkillDraftOptions {
  name: string;
  goal: string;
  force: boolean;
  print: boolean;
}

interface SkillTransferOptions {
  source: string;
  force: boolean;
}

interface SkillInstallOptions {
  source: string;
  force: boolean;
  version?: string;
}

interface SkillSearchOptions {
  query: string;
  limit: number;
  json: boolean;
}

interface SkillInfoOptions {
  name: string;
  remote: boolean;
}

interface SkillUpdateOptions {
  name?: string;
  all: boolean;
}

interface SkillCheckOptions {
  json: boolean;
}

function parseSkillNewArgs(args: string[]): SkillNewOptions {
  let name: string | undefined;

  for (const arg of args) {
    if (arg.startsWith("-")) {
      throw new ValidationError(
        `Unknown option: ${arg}. Usage: hlvm skill new <name>`,
        "hlvm skill new",
      );
    }
    if (name) {
      throw new ValidationError(
        "Too many arguments. Usage: hlvm skill new <name>",
        "hlvm skill new",
      );
    }
    name = arg;
  }

  return {
    name: parseSkillName(name, "hlvm skill new <name>"),
  };
}

async function skillNew(args: string[]): Promise<void> {
  const options = parseSkillNewArgs(args);
  const result = await createUserSkill(options.name);
  log.raw.log(`Created ${result.skillFile}`);
}

function parseSkillDraftArgs(args: string[]): SkillDraftOptions {
  let name: string | undefined;
  const goalParts: string[] = [];
  let force = false;
  let print = false;
  const usage = "hlvm skill draft <name> <goal...> [--force] [--print]";

  for (const arg of args) {
    if (arg === "--force") {
      force = true;
      continue;
    }
    if (arg === "--print") {
      print = true;
      continue;
    }
    if (arg.startsWith("-")) {
      throw new ValidationError(
        `Unknown option: ${arg}. Usage: ${usage}`,
        usage,
      );
    }
    if (!name) {
      name = arg;
      continue;
    }
    goalParts.push(arg);
  }

  return {
    name: parseSkillName(name, usage),
    goal: goalParts.join(" "),
    force,
    print,
  };
}

async function skillDraft(args: string[]): Promise<void> {
  const options = parseSkillDraftArgs(args);
  if (options.print) {
    log.raw.log(renderSkillDraftContent(options.name, options.goal));
    return;
  }

  const result = await draftUserSkill(options.name, options.goal, {
    force: options.force,
  });
  log.raw.log(`Drafted ${result.skillFile}`);
  log.raw.log(`Edit it, then run /${result.name} <request> to use it.`);
}

function parsePositiveInteger(value: string, usage: string): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed < 1 || String(parsed) !== value) {
    throw new ValidationError(
      `Expected a positive integer. Usage: ${usage}`,
      usage,
    );
  }
  return parsed;
}

function parseSkillSearchArgs(args: string[]): SkillSearchOptions {
  const queryParts: string[] = [];
  let limit = 20;
  let json = false;

  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === "--json") {
      json = true;
      continue;
    }
    if (arg === "--limit") {
      const value = args[++index];
      if (!value) {
        throw new ValidationError(
          "Missing --limit value. Usage: hlvm skill search [query] [--limit <n>] [--json]",
          "hlvm skill search",
        );
      }
      limit = parsePositiveInteger(
        value,
        "hlvm skill search [query] [--limit <n>] [--json]",
      );
      continue;
    }
    if (arg.startsWith("-")) {
      throw new ValidationError(
        `Unknown option: ${arg}. Usage: hlvm skill search [query] [--limit <n>] [--json]`,
        "hlvm skill search",
      );
    }
    queryParts.push(arg);
  }

  return { query: queryParts.join(" "), limit, json };
}

function formatRepositoryVersion(entry: SkillRepositoryEntry): string {
  return entry.version ?? "-";
}

function formatRepositoryStatus(entry: SkillRepositoryEntry): string {
  if (!entry.deprecated) return entry.trust;
  return typeof entry.deprecated === "string"
    ? `deprecated: ${entry.deprecated}`
    : "deprecated";
}

function printSkillSearchResults(results: SkillRepositoryEntry[]): void {
  if (results.length === 0) {
    log.raw.log("No repository skills found.");
    return;
  }
  const slugWidth = 24;
  const versionWidth = 10;
  const trustWidth = 12;
  log.raw.log(
    `${pad("SLUG", slugWidth)}  ${pad("VERSION", versionWidth)}  ${
      pad("TRUST", trustWidth)
    }  DESCRIPTION`,
  );
  for (const entry of results) {
    log.raw.log(
      `${pad(entry.slug, slugWidth)}  ${
        pad(formatRepositoryVersion(entry), versionWidth)
      }  ${
        pad(formatRepositoryStatus(entry), trustWidth)
      }  ${entry.description}`,
    );
  }
}

async function skillSearch(args: string[]): Promise<void> {
  const options = parseSkillSearchArgs(args);
  const results = await searchSkillRepository({
    query: options.query,
    limit: options.limit,
  });
  if (options.json) {
    log.raw.log(JSON.stringify({ results }, null, 2));
    return;
  }
  printSkillSearchResults(results);
}

function parseSkillTransferArgs(
  args: string[],
  usage: string,
): SkillTransferOptions {
  let source: string | undefined;
  let force = false;

  for (const arg of args) {
    if (arg === "--force") {
      force = true;
      continue;
    }
    if (arg.startsWith("-")) {
      throw new ValidationError(
        `Unknown option: ${arg}. Usage: ${usage}`,
        usage,
      );
    }
    if (source) {
      throw new ValidationError(
        `Too many arguments. Usage: ${usage}`,
        usage,
      );
    }
    source = arg;
  }

  if (!source) {
    throw new ValidationError(`Missing source. Usage: ${usage}`, usage);
  }
  return { source, force };
}

function parseSkillInstallArgs(args: string[]): SkillInstallOptions {
  let source: string | undefined;
  let force = false;
  let version: string | undefined;
  const usage =
    "hlvm skill install <slug-or-git-source> [--version <version>] [--force]";

  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === "--force") {
      force = true;
      continue;
    }
    if (arg === "--version") {
      const value = args[++index];
      if (!value) {
        throw new ValidationError(
          `Missing --version value. Usage: ${usage}`,
          usage,
        );
      }
      version = value;
      continue;
    }
    if (arg.startsWith("-")) {
      throw new ValidationError(
        `Unknown option: ${arg}. Usage: ${usage}`,
        usage,
      );
    }
    if (source) {
      throw new ValidationError(
        `Too many arguments. Usage: ${usage}`,
        usage,
      );
    }
    source = arg;
  }

  if (!source) {
    throw new ValidationError(`Missing source. Usage: ${usage}`, usage);
  }
  return { source, force, version };
}

function printSkillInstallResult(
  verb: string,
  result: SkillInstallResult,
): void {
  if (result.installed.length === 1) {
    const skill = result.installed[0];
    log.raw.log(`${verb} ${skill.name} -> ${skill.targetDir}`);
  } else {
    log.raw.log(`${verb} ${result.installed.length} skills:`);
    for (const skill of result.installed) {
      log.raw.log(`  ${skill.name} -> ${skill.targetDir}`);
    }
  }
  for (const warning of result.warnings) {
    log.raw.warn(`Warning: ${warning}`);
  }
}

async function skillImport(args: string[]): Promise<void> {
  const options = parseSkillTransferArgs(
    args,
    "hlvm skill import <path> [--force]",
  );
  const result = await importSkillPath(options.source, {
    force: options.force,
  });
  printSkillInstallResult("Imported", result);
}

async function skillInstall(args: string[]): Promise<void> {
  const options = parseSkillInstallArgs(args);
  if (isSkillRepositorySlug(options.source)) {
    const result = await installSkillFromRepositorySlug(options.source, {
      force: options.force,
      version: options.version,
    });
    printSkillInstallResult("Installed", result.installed);
    return;
  }
  if (options.version) {
    throw new ValidationError(
      "Use #ref for Git sources; --version only applies to repository slugs.",
      "hlvm skill install",
    );
  }
  printSkillInstallResult(
    "Installed",
    await installSkillFromGit(options.source, { force: options.force }),
  );
}

function parseSkillUpdateArgs(args: string[]): SkillUpdateOptions {
  let name: string | undefined;
  let all = false;

  for (const arg of args) {
    if (arg === "--all") {
      all = true;
      continue;
    }
    if (arg.startsWith("-")) {
      throw new ValidationError(
        `Unknown option: ${arg}. Usage: hlvm skill update <name|--all>`,
        "hlvm skill update",
      );
    }
    if (name) {
      throw new ValidationError(
        "Too many arguments. Usage: hlvm skill update <name|--all>",
        "hlvm skill update",
      );
    }
    name = arg;
  }

  if (name && all) {
    throw new ValidationError(
      "Use either a skill name or --all.",
      "hlvm skill update",
    );
  }
  if (!name && !all) {
    throw new ValidationError(
      "Provide a skill name or use --all. Usage: hlvm skill update <name|--all>",
      "hlvm skill update",
    );
  }
  return {
    name: name ? parseSkillName(name, "hlvm skill update <name|--all>") : name,
    all,
  };
}

function printSkillUpdateResults(results: SkillUpdateResult[]): void {
  if (results.length === 0) {
    log.raw.log("No tracked skills to update.");
    return;
  }
  for (const result of results) {
    if (result.error) {
      log.raw.error(`Failed ${result.name}: ${result.error}`);
      continue;
    }
    if (result.changed) {
      log.raw.log(`Updated ${result.name} -> ${result.targetDir}`);
      continue;
    }
    log.raw.log(`${result.name} already up to date`);
  }
}

async function skillUpdate(args: string[]): Promise<void> {
  const options = parseSkillUpdateArgs(args);
  const results = await updateSkills(
    options.all ? { all: true } : { name: options.name! },
  );
  printSkillUpdateResults(results);
}

async function skillRemove(args: string[]): Promise<void> {
  if (args.length > 1) {
    throw new ValidationError(
      "Too many arguments. Usage: hlvm skill remove <name>",
      "hlvm skill remove",
    );
  }
  const name = parseSkillName(args[0], "hlvm skill remove <name>");
  const result = await removeSkill(name);
  log.raw.log(`Removed ${result.name} -> ${result.targetDir}`);
}

function parseSkillCheckArgs(args: string[]): SkillCheckOptions {
  let json = false;
  for (const arg of args) {
    if (arg === "--json") {
      json = true;
      continue;
    }
    throw new ValidationError(
      `Unknown option: ${arg}. Usage: hlvm skill check [--json]`,
      "hlvm skill check",
    );
  }
  return { json };
}

function printSkillCheck(result: SkillCheckResult): void {
  log.raw.log("Skills Status Check");
  log.raw.log("");
  log.raw.log(`Total:    ${result.total}`);
  log.raw.log(`Ready:    ${result.ready}`);
  log.raw.log(`Warnings: ${result.warnings}`);
  log.raw.log(`Errors:   ${result.errors}`);
  if (result.entries.length === 0) return;
  log.raw.log("");
  for (const entry of result.entries) {
    const marker = entry.status === "ready"
      ? "ok"
      : entry.status === "warning"
      ? "warn"
      : "error";
    log.raw.log(`${marker.padEnd(5)} ${entry.name} (${entry.source})`);
    for (const error of entry.errors) {
      log.raw.log(`      error: ${error}`);
    }
    for (const warning of entry.warnings) {
      log.raw.log(`      warning: ${warning}`);
    }
  }
}

async function skillCheck(args: string[]): Promise<number> {
  const options = parseSkillCheckArgs(args);
  const result = await checkSkills();
  if (options.json) {
    log.raw.log(JSON.stringify(result, null, 2));
    return result.errors > 0 ? 1 : 0;
  }
  printSkillCheck(result);
  return result.errors > 0 ? 1 : 0;
}

function formatOriginSource(origin: SkillOrigin): string {
  if (origin.source === "authored" && origin.authored) {
    return `authored ${origin.authored.method}`;
  }
  if (origin.source === "git" && origin.git) {
    const ref = origin.git.ref ? `#${origin.git.ref}` : "";
    const subpath = origin.git.subpath ? ` (${origin.git.subpath})` : "";
    return `git ${origin.git.cloneUrl}${ref}${subpath}`;
  }
  if (origin.source === "local" && origin.local) {
    return `local ${origin.local.path}`;
  }
  return origin.source;
}

function parseSkillInfoArgs(args: string[]): SkillInfoOptions {
  let name: string | undefined;
  let remote = false;
  const usage = "hlvm skill info <name> [--remote]";

  for (const arg of args) {
    if (arg === "--remote") {
      remote = true;
      continue;
    }
    if (arg.startsWith("-")) {
      throw new ValidationError(
        `Unknown option: ${arg}. Usage: ${usage}`,
        usage,
      );
    }
    if (name) {
      throw new ValidationError(
        `Too many arguments. Usage: ${usage}`,
        usage,
      );
    }
    name = arg;
  }

  return { name: parseSkillName(name, usage), remote };
}

function printSkillRepositoryInfo(entry: SkillRepositoryEntry): void {
  log.raw.log(`Slug:        ${entry.slug}`);
  if (entry.name) {
    log.raw.log(`Name:        ${entry.name}`);
  }
  log.raw.log(`Description: ${entry.description}`);
  log.raw.log(`Version:     ${formatRepositoryVersion(entry)}`);
  log.raw.log(`Trust:       ${entry.trust}`);
  log.raw.log(`Install:     ${entry.install}`);
  if (entry.versions && Object.keys(entry.versions).length > 0) {
    log.raw.log(`Versions:    ${Object.keys(entry.versions).join(", ")}`);
  }
  if (entry.license) {
    log.raw.log(`License:     ${entry.license}`);
  }
  if (entry.tags.length > 0) {
    log.raw.log(`Tags:        ${entry.tags.join(", ")}`);
  }
  if (entry.homepage) {
    log.raw.log(`Homepage:    ${entry.homepage}`);
  }
  if (entry.deprecated) {
    log.raw.log(
      `Deprecated:  ${
        typeof entry.deprecated === "string" ? entry.deprecated : "yes"
      }`,
    );
  }
}

async function skillInfo(args: string[]): Promise<void> {
  const options = parseSkillInfoArgs(args);
  if (options.remote) {
    const entry = await findSkillRepositoryEntry(options.name);
    if (!entry) {
      throw new ValidationError(
        `Skill not found in repository: ${options.name}`,
        "hlvm skill info",
      );
    }
    printSkillRepositoryInfo(entry);
    return;
  }
  const snapshot = await loadSkillSnapshot();
  const skill = findSkillByName(snapshot, options.name);
  if (!skill) {
    throw new ValidationError(
      `Skill not found: ${options.name}`,
      "hlvm skill info",
    );
  }

  log.raw.log(`Name:        ${skill.name}`);
  log.raw.log(`Description: ${skill.description}`);
  log.raw.log(`Source:      ${skill.source}`);
  log.raw.log(`Path:        ${skill.filePath}`);
  if (skill.license) {
    log.raw.log(`License:     ${skill.license}`);
  }
  if (skill.compatibility) {
    log.raw.log(`Compatibility: ${skill.compatibility}`);
  }
  if (skill.allowedTools?.length) {
    log.raw.log(`Allowed tools: ${skill.allowedTools.join(" ")}`);
  }
  if (skill.metadata && Object.keys(skill.metadata).length > 0) {
    log.raw.log("Metadata:");
    for (const [key, value] of Object.entries(skill.metadata)) {
      log.raw.log(`  ${key}: ${value}`);
    }
  }
  if (skill.source === "user") {
    const origin = await readSkillOrigin(skill.baseDir);
    if (origin) {
      log.raw.log(`Origin:      ${formatOriginSource(origin)}`);
      if (origin.git?.commit) {
        log.raw.log(`Commit:      ${origin.git.commit}`);
      }
      log.raw.log(`Content hash: ${origin.contentHash}`);
    }
  }

  const body = await readSkillBody(skill);
  const preview = body.split(/\r?\n/).slice(0, BODY_PREVIEW_LINES).join("\n")
    .trim();
  log.raw.log("");
  log.raw.log("Body:");
  log.raw.log(preview || "(empty)");
}
