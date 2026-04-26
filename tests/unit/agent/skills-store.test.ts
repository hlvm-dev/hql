import { assertEquals, assertStringIncludes } from "jsr:@std/assert@1";
import {
  getBundledSkillsDir,
  getUserSkillsDir,
} from "../../../src/common/paths.ts";
import { getPlatform } from "../../../src/platform/platform.ts";
import {
  isValidSkillName,
  loadSkillSnapshot,
  readSkillBody,
} from "../../../src/hlvm/agent/skills/store.ts";
import { formatSkillsForPrompt } from "../../../src/hlvm/agent/skills/prompt.ts";
import { resolveToolPath } from "../../../src/hlvm/agent/path-utils.ts";
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
    const debug = snapshot.skills.find((skill) => skill.name === "debug");

    assertEquals(debug?.name, "debug");
    assertEquals(debug?.source, "user");
    assertEquals(debug?.description, "User debug workflow");
    assertEquals(
      snapshot.duplicates.some((duplicate) => duplicate.name === "debug"),
      true,
    );
    assertEquals(
      await readSkillBody(debug!),
      "Use the user workflow.",
    );
  });
});

Deno.test("skills store: loads bundled skills by default", async () => {
  await withTempHlvmDir(async () => {
    const snapshot = await loadSkillSnapshot();
    const names = snapshot.skills.map((skill) => skill.name);

    assertEquals(names.includes("debug"), true);
    assertEquals(names.includes("verify"), true);
    assertEquals(names.includes("code-review"), true);
    assertEquals(names.includes("refactor"), true);
    assertEquals(names.includes("plan"), true);
    assertEquals(names.includes("write-docs"), true);
    assertEquals(names.includes("skill-author"), true);

    const debug = snapshot.skills.find((skill) => skill.name === "debug");
    assertEquals(debug?.source, "bundled");
    assertEquals(debug?.filePath.startsWith(getBundledSkillsDir()), true);
    assertStringIncludes(await readSkillBody(debug!), "Use this skill");
  });
});

Deno.test("skills store: bundled skill files are readable through the tool path sandbox", async () => {
  await withTempHlvmDir(async () => {
    await withTempDir(async (workspace) => {
      const snapshot = await loadSkillSnapshot();
      const debug = snapshot.skills.find((skill) => skill.name === "debug");

      const resolved = await resolveToolPath(debug!.filePath, workspace);

      assertEquals(resolved, debug!.filePath);
    });
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

    const mismatchedDir = platform.path.join(root, "mismatched-name");
    await platform.fs.mkdir(mismatchedDir, { recursive: true });
    await platform.fs.writeTextFile(
      platform.path.join(mismatchedDir, "SKILL.md"),
      `---
name: different-name
description: Directory and name do not match
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

    const longDescriptionDir = platform.path.join(root, "long-description");
    await platform.fs.mkdir(longDescriptionDir, { recursive: true });
    await platform.fs.writeTextFile(
      platform.path.join(longDescriptionDir, "SKILL.md"),
      `---
name: long-description
description: ${"x".repeat(1025)}
---

Body
`,
    );

    const snapshot = await loadSkillSnapshot();

    assertEquals(
      snapshot.skills.some((skill) => skill.name === "valid-skill"),
      true,
    );
    assertEquals(
      snapshot.skills.some((skill) => skill.name === "bad-skill"),
      false,
    );
    assertEquals(
      snapshot.skills.some((skill) => skill.name === "missing-description"),
      false,
    );
    assertEquals(
      snapshot.skills.some((skill) => skill.name === "different-name"),
      false,
    );
    assertEquals(
      snapshot.skills.some((skill) => skill.name === "long-description"),
      false,
    );
    assertEquals(isValidSkillName("valid-skill"), true);
    assertEquals(isValidSkillName("Invalid"), false);
    assertEquals(isValidSkillName("bad_name"), false);
  });
});

Deno.test("skills store: parses official agentskills optional frontmatter", async () => {
  await withTempHlvmDir(async () => {
    const platform = getPlatform();
    const root = getUserSkillsDir();
    const skillDir = platform.path.join(root, "pdf-flow");
    await platform.fs.mkdir(skillDir, { recursive: true });
    await platform.fs.writeTextFile(
      platform.path.join(skillDir, "SKILL.md"),
      `---
name: pdf-flow
description: Extract, inspect, and transform PDF files. Use when the user asks about PDF processing.
license: Apache-2.0
compatibility: Requires Python and local filesystem access.
metadata:
  author: hlvm
  version: "1.0"
allowed-tools: Bash(pdfinfo:*) Read
---

Process the PDF.
`,
    );

    const snapshot = await loadSkillSnapshot();
    const skill = snapshot.skills.find((entry) => entry.name === "pdf-flow");

    assertEquals(skill?.license, "Apache-2.0");
    assertEquals(
      skill?.compatibility,
      "Requires Python and local filesystem access.",
    );
    assertEquals(skill?.metadata, { author: "hlvm", version: "1.0" });
    assertEquals(skill?.allowedTools, ["Bash(pdfinfo:*)", "Read"]);
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

    assertEquals(
      snapshot.skills.some((skill) => skill.name === "large-skill"),
      false,
    );
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

      assertEquals(
        snapshot.skills.some((skill) => skill.name === "linked-skill"),
        false,
      );
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

      assertEquals(
        snapshot.skills.some((skill) => skill.name === "local-only"),
        false,
      );
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
