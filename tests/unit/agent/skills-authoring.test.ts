import {
  assertEquals,
  assertStringIncludes,
  assertThrows,
} from "jsr:@std/assert@1";
import {
  buildAiSkillDraftPrompt,
  buildAiSkillImprovePrompt,
  normalizeAuthoredSkillContent,
} from "../../../src/hlvm/agent/skills/authoring.ts";
import { ValidationError } from "../../../src/common/error.ts";

Deno.test("skills authoring: draft prompt constrains portable SKILL.md output", () => {
  const prompt = buildAiSkillDraftPrompt(
    "debug-hang",
    "Diagnose commands that hang after tool output",
  );

  assertStringIncludes(prompt, "Skill name: debug-hang");
  assertStringIncludes(prompt, "Return only the SKILL.md markdown");
  assertStringIncludes(prompt, "name: debug-hang");
  assertStringIncludes(prompt, "license: MIT");
  assertStringIncludes(prompt, "portable across agent tools");
});

Deno.test("skills authoring: improve prompt includes existing skill and instruction", () => {
  const prompt = buildAiSkillImprovePrompt(
    "debug-hang",
    "---\nname: debug-hang\ndescription: old\n---\n\n# Debug Hang",
    "make verification concrete",
  );

  assertStringIncludes(prompt, "Skill name: debug-hang");
  assertStringIncludes(prompt, "make verification concrete");
  assertStringIncludes(prompt, "Existing SKILL.md:");
  assertStringIncludes(prompt, "# Debug Hang");
});

Deno.test("skills authoring: normalizes fenced valid skill content", () => {
  const content = normalizeAuthoredSkillContent(
    "debug-hang",
    "```markdown\n---\nname: debug-hang\ndescription: Use when debugging hangs.\nlicense: MIT\n---\n\n# Debug Hang\n\nFollow steps.\n```",
    "hlvm skill draft",
  );

  assertStringIncludes(content, "name: debug-hang");
  assertStringIncludes(content, "# Debug Hang");
  assertEquals(content.endsWith("\n"), true);
});

Deno.test("skills authoring: extracts embedded fenced skill content", () => {
  const content = normalizeAuthoredSkillContent(
    "debug-hang",
    "Here is the skill:\n\n```markdown\n---\nname: debug-hang\ndescription: Use when debugging hangs.\nlicense: MIT\n---\n\n# Debug Hang\n\nFollow steps.\n```\n",
    "hlvm skill draft",
  );

  assertEquals(content.startsWith("---\nname: debug-hang"), true);
  assertStringIncludes(content, "# Debug Hang");
});

Deno.test("skills authoring: converts yaml fence plus body to SKILL.md", () => {
  const content = normalizeAuthoredSkillContent(
    "debug-hang",
    "```yaml\nname: debug-hang\ndescription: Use when debugging hangs.\nlicense: MIT\n```\n\n# Debug Hang\n\nFollow steps.\n```",
    "hlvm skill draft",
  );

  assertEquals(content.startsWith("---\nname: debug-hang"), true);
  assertStringIncludes(content, "license: MIT");
  assertStringIncludes(content, "# Debug Hang");
});

Deno.test("skills authoring: rejects invalid generated skill content", () => {
  assertThrows(
    () =>
      normalizeAuthoredSkillContent(
        "debug-hang",
        "---\nname: other\ndescription: wrong\n---\n\n# Wrong",
        "hlvm skill draft",
      ),
    ValidationError,
    "must match directory name",
  );

  assertThrows(
    () =>
      normalizeAuthoredSkillContent(
        "debug-hang",
        "---\nname: debug-hang\ndescription: empty\n---\n",
        "hlvm skill draft",
      ),
    ValidationError,
    "Generated skill body is empty",
  );
});
