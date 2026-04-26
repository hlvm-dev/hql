import { log } from "../../api/log.ts";
import { ValidationError } from "../../../common/error.ts";
import { getUserSkillsDir } from "../../../common/paths.ts";
import { truncate } from "../../../common/utils.ts";
import { getPlatform } from "../../../platform/platform.ts";
import {
  importSkillPath,
  installSkillFromGit,
  type SkillInstallResult,
} from "../../agent/skills/install.ts";
import {
  clearSkillSnapshotCache,
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
  info <name>           Show skill metadata and a body preview
  import <path>         Import a local skill folder or skill pack
  install <git-source>  Install a skill from Git/GitHub

Examples:
  hlvm skill list
  hlvm skill new debug-workflow
  hlvm skill info debug-workflow
  hlvm skill import ./debug-workflow
  hlvm skill install github:owner/repo/path/to/skill
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

export async function skillCommand(args: string[]): Promise<void> {
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

interface SkillTransferOptions {
  source: string;
  force: boolean;
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
  const platform = getPlatform();
  const root = getUserSkillsDir();
  const skillDir = platform.path.join(root, options.name);
  const skillFile = platform.path.join(skillDir, "SKILL.md");

  if (await platform.fs.exists(skillDir)) {
    throw new ValidationError(
      `Skill already exists at ${skillDir}`,
      "hlvm skill new",
    );
  }

  await platform.fs.mkdir(skillDir, { recursive: true });
  await platform.fs.writeTextFile(skillFile, scaffoldSkill(options.name), {
    createNew: true,
  });
  clearSkillSnapshotCache();
  log.raw.log(`Created ${skillFile}`);
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
  const options = parseSkillTransferArgs(
    args,
    "hlvm skill install <git-source> [--force]",
  );
  const result = await installSkillFromGit(options.source, {
    force: options.force,
  });
  printSkillInstallResult("Installed", result);
}

function scaffoldSkill(name: string): string {
  const title = name.split("-").map((part) =>
    part.charAt(0).toUpperCase() + part.slice(1)
  ).join(" ");
  return `---
name: ${name}
description: Use when working on ${name}.
---

# ${title}

Describe when to use this skill and the steps the agent should follow.
`;
}

async function skillInfo(args: string[]): Promise<void> {
  if (args.length > 1) {
    throw new ValidationError(
      "Too many arguments. Usage: hlvm skill info <name>",
      "hlvm skill info",
    );
  }
  const name = parseSkillName(args[0], "hlvm skill info <name>");
  const snapshot = await loadSkillSnapshot();
  const skill = findSkillByName(snapshot, name);
  if (!skill) {
    throw new ValidationError(`Skill not found: ${name}`, "hlvm skill info");
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

  const body = await readSkillBody(skill);
  const preview = body.split(/\r?\n/).slice(0, BODY_PREVIEW_LINES).join("\n")
    .trim();
  log.raw.log("");
  log.raw.log("Body:");
  log.raw.log(preview || "(empty)");
}
