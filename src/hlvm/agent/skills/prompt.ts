import type { SkillEntry, SkillSnapshot } from "./types.ts";

export const AVAILABLE_SKILLS_PROMPT_SENTINEL =
  "<!-- hlvm:available-skills -->";

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function formatSkill(entry: SkillEntry): string[] {
  return [
    "  <skill>",
    `    <name>${escapeXml(entry.name)}</name>`,
    `    <description>${escapeXml(entry.description)}</description>`,
    `    <location>${escapeXml(entry.filePath)}</location>`,
    "  </skill>",
  ];
}

export function formatSkillsForPrompt(snapshot: SkillSnapshot): string {
  if (snapshot.skills.length === 0) return "";

  const lines = [
    AVAILABLE_SKILLS_PROMPT_SENTINEL,
    "The following skills provide specialized instructions for specific tasks.",
    "Use the read tool to load a skill's file when the task matches its description.",
    "When a skill file references a relative path, resolve it against the skill directory.",
    "",
    "<available_skills>",
  ];

  for (const skill of snapshot.skills) {
    lines.push(...formatSkill(skill));
  }

  lines.push("</available_skills>");
  return lines.join("\n");
}
