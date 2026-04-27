import { splitFrontmatter } from "../../../common/frontmatter.ts";
import { ValidationError } from "../../../common/error.ts";
import { MAX_SKILL_FILE_BYTES, parseSkillDefinition } from "./store.ts";

const MAX_AUTHORING_INPUT_CHARS = 12_000;

function trimInput(value: string, field: string, command: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new ValidationError(`Missing ${field}.`, command);
  }
  if (trimmed.length > MAX_AUTHORING_INPUT_CHARS) {
    throw new ValidationError(
      `${field} must be ${MAX_AUTHORING_INPUT_CHARS} characters or less.`,
      command,
    );
  }
  return trimmed;
}

export function buildAiSkillDraftPrompt(
  name: string,
  goal: string,
): string {
  const normalizedGoal = trimInput(goal, "draft goal", "hlvm skill draft");
  return `Create one agentskills.io SKILL.md file.

Skill name: ${name}
Workflow goal: ${normalizedGoal}

Return only the SKILL.md markdown. Do not wrap it in explanation.

Hard requirements:
- Start with YAML frontmatter.
- Frontmatter must include exactly these required fields:
  name: ${name}
  description: a concise "Use when..." sentence under 1024 characters
  license: MIT
- Do not add product-specific fields.
- Body must be concise procedural markdown.
- Include these sections only when useful:
  # Title
  ## Workflow
  ## Guardrails
  ## Verification
  ## Response Shape
- Keep the skill portable across agent tools.
- Do not include secrets, absolute machine paths, or hidden automation.
- Do not make the skill execute code directly; it instructs the normal agent loop.
`;
}

export function buildAiSkillImprovePrompt(
  name: string,
  existingSkill: string,
  instruction: string,
): string {
  const normalizedInstruction = trimInput(
    instruction,
    "improvement instruction",
    "hlvm skill improve",
  );
  const normalizedSkill = trimInput(
    existingSkill,
    "existing skill content",
    "hlvm skill improve",
  );
  return `Improve this agentskills.io SKILL.md file.

Skill name: ${name}
Improvement request: ${normalizedInstruction}

Return only the complete replacement SKILL.md markdown. Do not wrap it in explanation.

Hard requirements:
- Keep frontmatter name exactly: ${name}
- Keep or add license: MIT unless the existing license is more specific.
- Keep the result portable across agent tools.
- Keep the body concise and procedural.
- Do not add product-specific fields unless already required by the skill.
- Do not include secrets, absolute machine paths, or hidden automation.
- Do not make the skill execute code directly; it instructs the normal agent loop.

Existing SKILL.md:

${normalizedSkill}
`;
}

function convertYamlFenceToFrontmatter(text: string): string | null {
  const trimmed = text.trim().replace(/\r\n/g, "\n");
  const yamlFence = trimmed.match(
    /^```ya?ml\s*\n([\s\S]*?)\n```\s*([\s\S]*)$/i,
  );
  if (!yamlFence) return null;
  const frontmatter = yamlFence[1].trim();
  const body = yamlFence[2].trim().replace(/\n```$/, "").trim();
  return `---\n${frontmatter}\n---\n\n${body}`;
}

function stripMarkdownFence(text: string): string {
  const trimmed = text.trim().replace(/\r\n/g, "\n");
  const yamlConverted = convertYamlFenceToFrontmatter(trimmed);
  if (yamlConverted) return yamlConverted;
  const exactFence = trimmed.match(
    /^```(?:markdown|md)?\s*\n([\s\S]*?)\n```$/i,
  );
  if (exactFence) return exactFence[1].trim();
  const embeddedFence = trimmed.match(
    /```(?:markdown|md)?\s*\n([\s\S]*?)\n```/i,
  );
  return embeddedFence ? embeddedFence[1].trim() : trimmed;
}

function sliceFromFrontmatter(text: string): string {
  const frontmatterStart = text.indexOf("---\n");
  return frontmatterStart >= 0 ? text.slice(frontmatterStart).trim() : text;
}

export function normalizeAuthoredSkillContent(
  name: string,
  rawContent: string,
  command: string,
): string {
  const trimmed = sliceFromFrontmatter(stripMarkdownFence(rawContent)).trim();
  const content = trimmed.endsWith("\n---") ? `${trimmed}\n` : trimmed;
  if (!content) {
    throw new ValidationError("Generated skill content is empty.", command);
  }
  if (new TextEncoder().encode(content).byteLength > MAX_SKILL_FILE_BYTES) {
    throw new ValidationError(
      `${command} generated a SKILL.md larger than ${MAX_SKILL_FILE_BYTES} bytes.`,
      command,
    );
  }
  parseSkillDefinition(content, { expectedName: name });

  const { body } = splitFrontmatter(content);
  if (!body.trim()) {
    throw new ValidationError("Generated skill body is empty.", command);
  }
  return `${content.trimEnd()}\n`;
}
