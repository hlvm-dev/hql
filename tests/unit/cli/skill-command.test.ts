import {
  assertEquals,
  assertRejects,
  assertStringIncludes,
} from "jsr:@std/assert";
import { getUserSkillsDir } from "../../../src/common/paths.ts";
import { ValidationError } from "../../../src/common/error.ts";
import { getPlatform } from "../../../src/platform/platform.ts";
import { skillCommand } from "../../../src/hlvm/cli/commands/skill.ts";
import { withCapturedOutput } from "../../shared/light-helpers.ts";
import { withTempDir, withTempHlvmDir } from "../helpers.ts";

Deno.test("skill command: new creates a global user skill scaffold", async () => {
  await withTempHlvmDir(async () => {
    await withCapturedOutput(async (output) => {
      await skillCommand(["new", "example-skill"]);

      const platform = getPlatform();
      const skillFile = platform.path.join(
        getUserSkillsDir(),
        "example-skill",
        "SKILL.md",
      );
      const content = await platform.fs.readTextFile(skillFile);

      assertStringIncludes(output(), `Created ${skillFile}`);
      assertStringIncludes(content, "name: example-skill");
      assertStringIncludes(
        content,
        "description: Use when working on example-skill.",
      );
    });
  });
});

Deno.test("skill command: new ignores cwd and always creates a global skill", async () => {
  await withTempHlvmDir(async () => {
    await withTempDir(async (cwd) => {
      const originalCwd = Deno.cwd();
      Deno.chdir(cwd);
      try {
        await withCapturedOutput(async (output) => {
          await skillCommand(["new", "global-flow"]);

          const platform = getPlatform();
          const skillFile = platform.path.join(
            getUserSkillsDir(),
            "global-flow",
            "SKILL.md",
          );
          const content = await platform.fs.readTextFile(skillFile);

          assertStringIncludes(output(), "Created ");
          assertStringIncludes(output(), "global-flow/SKILL.md");
          assertStringIncludes(content, "name: global-flow");
        });
      } finally {
        Deno.chdir(originalCwd);
      }
    });
  });
});

Deno.test("skill command: list and info show user skills", async () => {
  await withTempHlvmDir(async () => {
    await withCapturedOutput(async () => {
      await skillCommand(["new", "debug-flow"]);
    });

    await withCapturedOutput(async (output) => {
      await skillCommand(["list"]);
      assertStringIncludes(output(), "debug-flow");
      assertStringIncludes(output(), "user");
      assertStringIncludes(output(), "Use when working on debug-flow.");
    });

    await withCapturedOutput(async (output) => {
      await skillCommand(["info", "debug-flow"]);
      assertStringIncludes(output(), "Name:        debug-flow");
      assertStringIncludes(output(), "Source:      user");
      assertStringIncludes(output(), "Body:");
      assertStringIncludes(output(), "Describe when to use this skill");
    });
  });
});

Deno.test("skill command: list explains empty state", async () => {
  await withTempHlvmDir(async () => {
    await withCapturedOutput(async (output) => {
      await skillCommand(["list"]);
      assertStringIncludes(output(), "No skills found.");
      assertStringIncludes(output(), "hlvm skill new <name>");
    });
  });
});

Deno.test("skill command: rejects invalid names and missing skills", async () => {
  await withTempHlvmDir(async () => {
    await assertRejects(
      () => skillCommand(["new", "BadName"]),
      ValidationError,
      "Skill names must be kebab-case",
    );
    await assertRejects(
      () => skillCommand(["info", "missing-skill"]),
      ValidationError,
      "Skill not found",
    );
    await assertRejects(
      () => skillCommand(["new", "help"]),
      ValidationError,
      "reserved by a built-in slash command",
    );
    await assertRejects(
      () => skillCommand(["new", "debug-flow", "--user"]),
      ValidationError,
      "Unknown option",
    );
  });
});

Deno.test("skill command: duplicate new fails before overwriting", async () => {
  await withTempHlvmDir(async () => {
    await withCapturedOutput(async () => {
      await skillCommand(["new", "same-skill"]);
    });
    const platform = getPlatform();
    const skillFile = platform.path.join(
      getUserSkillsDir(),
      "same-skill",
      "SKILL.md",
    );
    const original = await platform.fs.readTextFile(skillFile);

    await assertRejects(
      () => skillCommand(["new", "same-skill"]),
      ValidationError,
      "Skill already exists",
    );
    assertEquals(await platform.fs.readTextFile(skillFile), original);
  });
});
