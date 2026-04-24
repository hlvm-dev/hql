import { assertEquals, assertStringIncludes } from "jsr:@std/assert";
import { getUserSkillsDir } from "../../../src/common/paths.ts";
import { getPlatform } from "../../../src/platform/platform.ts";
import {
  isValidSkillName,
  loadSkillSnapshot,
  readSkillBody,
} from "../../../src/hlvm/agent/skills/store.ts";
import { formatSkillsForPrompt } from "../../../src/hlvm/agent/skills/prompt.ts";
import { withTempDir, withTempHlvmDir } from "../helpers.ts";

async function writeSkill(
  root: string,
  name: string,
  description: string,
  body = "Follow the documented workflow.",
): Promise<void> {
  const platform = getPlatform();
  const dir = platform.path.join(root, name);
  await platform.fs.mkdir(dir, { recursive: true });
  await platform.fs.writeTextFile(
    platform.path.join(dir, "SKILL.md"),
    `---
name: ${name}
description: ${description}
---

${body}
`,
  );
}

Deno.test("skills store: loads user-global skills", async () => {
  await withTempHlvmDir(async () => {
    await writeSkill(
      getUserSkillsDir(),
      "debug",
      "User debug workflow",
      "Use the user workflow.",
    );

    const snapshot = await loadSkillSnapshot();

    assertEquals(snapshot.skills.length, 1);
    assertEquals(snapshot.skills[0].name, "debug");
    assertEquals(snapshot.skills[0].source, "user");
    assertEquals(snapshot.skills[0].description, "User debug workflow");
    assertEquals(snapshot.duplicates.length, 0);
    assertEquals(
      await readSkillBody(snapshot.skills[0]),
      "Use the user workflow.",
    );
  });
});

Deno.test("skills store: skips invalid frontmatter and invalid names", async () => {
  await withTempHlvmDir(async () => {
    const root = getUserSkillsDir();
    await writeSkill(root, "valid-skill", "Valid workflow");

    const platform = getPlatform();
    const badDir = platform.path.join(root, "bad-skill");
    await platform.fs.mkdir(badDir, { recursive: true });
    await platform.fs.writeTextFile(
      platform.path.join(badDir, "SKILL.md"),
      `---
name: Bad Skill
description: Invalid name
---

Body
`,
    );

    const missingDescriptionDir = platform.path.join(
      root,
      "missing-description",
    );
    await platform.fs.mkdir(missingDescriptionDir, { recursive: true });
    await platform.fs.writeTextFile(
      platform.path.join(missingDescriptionDir, "SKILL.md"),
      `---
name: missing-description
---

Body
`,
    );

    const snapshot = await loadSkillSnapshot();

    assertEquals(snapshot.skills.map((skill) => skill.name), ["valid-skill"]);
    assertEquals(isValidSkillName("valid-skill"), true);
    assertEquals(isValidSkillName("Invalid"), false);
    assertEquals(isValidSkillName("bad_name"), false);
  });
});

Deno.test("skills store: skips oversized skill files", async () => {
  await withTempHlvmDir(async () => {
    const platform = getPlatform();
    const root = getUserSkillsDir();
    const skillDir = platform.path.join(root, "large-skill");
    await platform.fs.mkdir(skillDir, { recursive: true });
    await platform.fs.writeTextFile(
      platform.path.join(skillDir, "SKILL.md"),
      `---
name: large-skill
description: Oversized skill
---

${"x".repeat(300_000)}
`,
    );

    const snapshot = await loadSkillSnapshot();

    assertEquals(snapshot.skills, []);
  });
});

Deno.test("skills store: skips symlinked skill directories", async () => {
  await withTempHlvmDir(async () => {
    const platform = getPlatform();
    const externalRoot = await platform.fs.makeTempDir({
      prefix: "hlvm-external-skills-",
    });
    try {
      await writeSkill(
        externalRoot,
        "linked-skill",
        "Linked external skill",
      );
      const root = getUserSkillsDir();
      await platform.fs.mkdir(root, { recursive: true });
      await Deno.symlink(
        platform.path.join(externalRoot, "linked-skill"),
        platform.path.join(root, "linked-skill"),
        { type: "dir" },
      );

      const snapshot = await loadSkillSnapshot();

      assertEquals(snapshot.skills, []);
    } finally {
      await platform.fs.remove(externalRoot, { recursive: true });
    }
  });
});

Deno.test("skills store: ignores cwd-local skill directories", async () => {
  await withTempHlvmDir(async () => {
    await withTempDir(async (cwd) => {
      const platform = getPlatform();
      await writeSkill(
        platform.path.join(cwd, ".hlvm", "skills"),
        "local-only",
        "Should not load",
      );

      const snapshot = await loadSkillSnapshot();

      assertEquals(snapshot.skills, []);
    });
  });
});

Deno.test("skills prompt: formats compact XML and escapes content", () => {
  const prompt = formatSkillsForPrompt({
    skills: [{
      name: "review",
      description: 'Use <review> & "check" changes.',
      filePath: "/tmp/review/SKILL.md",
      baseDir: "/tmp/review",
      source: "user",
    }],
    duplicates: [],
  });

  assertStringIncludes(prompt, "<available_skills>");
  assertStringIncludes(prompt, "<name>review</name>");
  assertStringIncludes(
    prompt,
    "<description>Use &lt;review&gt; &amp; &quot;check&quot; changes.</description>",
  );
  assertStringIncludes(prompt, "<location>/tmp/review/SKILL.md</location>");
});

Deno.test("skills prompt: returns empty string when no skills exist", () => {
  assertEquals(formatSkillsForPrompt({ skills: [], duplicates: [] }), "");
});
