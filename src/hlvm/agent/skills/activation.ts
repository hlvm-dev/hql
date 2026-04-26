import { findSkillByName, loadSkillSnapshot, readSkillBody } from "./store.ts";
import { isReservedSkillName } from "./reserved.ts";
import type { SkillEntry } from "./types.ts";

export interface SkillActivation {
  name: string;
  source: SkillEntry["source"];
  filePath: string;
  prompt: string;
}

function stripSlashCommandName(commandName: string): string | null {
  if (!commandName.startsWith("/")) return null;
  const name = commandName.slice(1);
  return name.length > 0 ? name : null;
}

export function formatSkillActivation(
  skill: SkillEntry,
  body: string,
  args: string,
): string {
  const request = args.trim() || "Apply this skill.";
  return [
    `Use the ${skill.name} skill for this request.`,
    "",
    `Skill: ${skill.name}`,
    `Source: ${skill.source}`,
    `Path: ${skill.filePath}`,
    "",
    "Skill instructions:",
    body.trim(),
    "",
    `Request: ${request}`,
  ].join("\n");
}

export async function resolveSkillActivation(
  commandName: string,
  args: string,
): Promise<SkillActivation | null> {
  const skillName = stripSlashCommandName(commandName);
  if (!skillName) return null;
  if (isReservedSkillName(skillName)) return null;

  const snapshot = await loadSkillSnapshot();
  const skill = findSkillByName(snapshot, skillName);
  if (!skill) return null;

  const body = await readSkillBody(skill);
  return {
    name: skill.name,
    source: skill.source,
    filePath: skill.filePath,
    prompt: formatSkillActivation(skill, body, args),
  };
}

export async function resolveSkillSlashInput(
  input: string,
): Promise<SkillActivation | null> {
  const trimmed = input.trim();
  if (!trimmed.startsWith("/")) return null;
  const [commandName, ...args] = trimmed.split(/\s+/);
  return await resolveSkillActivation(commandName, args.join(" "));
}
