import {
  assertEquals,
  assertRejects,
  assertStringIncludes,
} from "jsr:@std/assert@1";
import { getUserSkillsDir } from "../../../src/common/paths.ts";
import { ValidationError } from "../../../src/common/error.ts";
import { getPlatform } from "../../../src/platform/platform.ts";
import { skillCommand } from "../../../src/hlvm/cli/commands/skill.ts";
import { readSkillOrigin } from "../../../src/hlvm/agent/skills/install.ts";
import { withCapturedOutput } from "../../shared/light-helpers.ts";
import { withTempDir, withTempHlvmDir } from "../helpers.ts";

async function writeSkillFixture(
  skillDir: string,
  name: string,
  description = `Use when testing ${name}.`,
): Promise<void> {
  const platform = getPlatform();
  await platform.fs.mkdir(skillDir, { recursive: true });
  await platform.fs.writeTextFile(
    platform.path.join(skillDir, "SKILL.md"),
    `---
name: ${name}
description: ${description}
---

# ${name}

Follow the fixture workflow.
`,
  );
}

async function runGit(cwd: string, args: string[]): Promise<void> {
  const result = await getPlatform().command.output({
    cmd: ["git", ...args],
    cwd,
    stdout: "piped",
    stderr: "piped",
  });
  assertEquals(
    result.success,
    true,
    new TextDecoder().decode(result.stderr || result.stdout),
  );
}

async function withSkillRepositoryIndex(
  indexUrl: string,
  fn: () => Promise<void>,
): Promise<void> {
  const platform = getPlatform();
  const previousAllow = platform.env.get("HLVM_ALLOW_TEST_STATE_ROOT");
  const previousIndex = platform.env.get("HLVM_TEST_SKILL_INDEX_URL");
  platform.env.set("HLVM_ALLOW_TEST_STATE_ROOT", "1");
  platform.env.set("HLVM_TEST_SKILL_INDEX_URL", indexUrl);
  try {
    await fn();
  } finally {
    if (previousAllow === undefined) {
      platform.env.delete("HLVM_ALLOW_TEST_STATE_ROOT");
    } else {
      platform.env.set("HLVM_ALLOW_TEST_STATE_ROOT", previousAllow);
    }
    if (previousIndex === undefined) {
      platform.env.delete("HLVM_TEST_SKILL_INDEX_URL");
    } else {
      platform.env.set("HLVM_TEST_SKILL_INDEX_URL", previousIndex);
    }
  }
}

async function writeSkillRepositoryIndex(
  indexFile: string,
  skills: Array<Record<string, unknown>>,
): Promise<void> {
  await getPlatform().fs.writeTextFile(
    indexFile,
    `${JSON.stringify({ version: 1, skills }, null, 2)}\n`,
  );
}

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

Deno.test("skill command: list shows bundled skills by default", async () => {
  await withTempHlvmDir(async () => {
    await withCapturedOutput(async (output) => {
      await skillCommand(["list"]);
      assertStringIncludes(output(), "debug");
      assertStringIncludes(output(), "verify");
      assertStringIncludes(output(), "bundled");
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

Deno.test("skill command: import copies a local skill into the global user root", async () => {
  await withTempHlvmDir(async () => {
    await withTempDir(async (sourceRoot) => {
      const platform = getPlatform();
      const sourceSkill = platform.path.join(sourceRoot, "source-name");
      await writeSkillFixture(sourceSkill, "imported-flow");

      await withCapturedOutput(async (output) => {
        await skillCommand(["import", sourceSkill]);
        assertStringIncludes(output(), "Imported imported-flow -> ");
      });

      const installedFile = platform.path.join(
        getUserSkillsDir(),
        "imported-flow",
        "SKILL.md",
      );
      assertStringIncludes(
        await platform.fs.readTextFile(installedFile),
        "name: imported-flow",
      );

      await withCapturedOutput(async (output) => {
        await skillCommand(["list"]);
        assertStringIncludes(output(), "imported-flow");
        assertStringIncludes(output(), "user");
      });
    });
  });
});

Deno.test("skill command: import stages and copies a local skill pack", async () => {
  await withTempHlvmDir(async () => {
    await withTempDir(async (sourceRoot) => {
      const platform = getPlatform();
      await writeSkillFixture(
        platform.path.join(sourceRoot, "alpha"),
        "alpha-flow",
      );
      await writeSkillFixture(
        platform.path.join(sourceRoot, "beta"),
        "beta-flow",
      );

      await withCapturedOutput(async (output) => {
        await skillCommand(["import", sourceRoot]);
        assertStringIncludes(output(), "Imported 2 skills:");
        assertStringIncludes(output(), "alpha-flow");
        assertStringIncludes(output(), "beta-flow");
      });

      await withCapturedOutput(async (output) => {
        await skillCommand(["info", "beta-flow"]);
        assertStringIncludes(output(), "Name:        beta-flow");
        assertStringIncludes(output(), "Follow the fixture workflow.");
      });
    });
  });
});

Deno.test("skill command: import requires --force before replacing a user skill", async () => {
  await withTempHlvmDir(async () => {
    await withTempDir(async (sourceRoot) => {
      const platform = getPlatform();
      const original = platform.path.join(sourceRoot, "original");
      const replacement = platform.path.join(sourceRoot, "replacement");
      await writeSkillFixture(
        original,
        "replace-flow",
        "Original description.",
      );
      await writeSkillFixture(
        replacement,
        "replace-flow",
        "Replacement description.",
      );

      await withCapturedOutput(async () => {
        await skillCommand(["import", original]);
      });
      await assertRejects(
        () => skillCommand(["import", replacement]),
        ValidationError,
        "Re-run with --force",
      );

      await withCapturedOutput(async (output) => {
        await skillCommand(["import", replacement, "--force"]);
        assertStringIncludes(output(), "Imported replace-flow -> ");
      });
      await withCapturedOutput(async (output) => {
        await skillCommand(["info", "replace-flow"]);
        assertStringIncludes(output(), "Replacement description.");
      });
    });
  });
});

Deno.test("skill command: import refuses invalid and symlinked skill sources", async () => {
  await withTempHlvmDir(async () => {
    await withTempDir(async (sourceRoot) => {
      const platform = getPlatform();
      const invalidSkill = platform.path.join(sourceRoot, "invalid-flow");
      await platform.fs.mkdir(invalidSkill, { recursive: true });
      await platform.fs.writeTextFile(
        platform.path.join(invalidSkill, "SKILL.md"),
        "---\nname: BadName\ndescription: invalid\n---\n",
      );
      await assertRejects(
        () => skillCommand(["import", invalidSkill]),
        ValidationError,
        "Skill names must be kebab-case",
      );

      const symlinkedSkill = platform.path.join(sourceRoot, "symlink-flow");
      await writeSkillFixture(symlinkedSkill, "symlink-flow");
      await Deno.symlink(
        platform.path.join(sourceRoot, "outside.txt"),
        platform.path.join(symlinkedSkill, "link.txt"),
      );
      await assertRejects(
        () => skillCommand(["import", symlinkedSkill]),
        ValidationError,
        "Refusing to import skill with symlink",
      );
    });
  });
});

Deno.test("skill command: install clones a git skill source into the global user root", async () => {
  await withTempHlvmDir(async () => {
    await withTempDir(async (repoDir) => {
      const platform = getPlatform();
      await writeSkillFixture(
        platform.path.join(repoDir, "git-flow"),
        "git-flow",
      );
      await runGit(repoDir, ["init"]);
      await runGit(repoDir, ["config", "user.email", "test@example.com"]);
      await runGit(repoDir, ["config", "user.name", "Test User"]);
      await runGit(repoDir, ["add", "."]);
      await runGit(repoDir, ["commit", "-m", "add skill"]);

      const source = platform.path.toFileUrl(repoDir).href;
      await withCapturedOutput(async (output) => {
        await skillCommand(["install", source]);
        assertStringIncludes(output(), "Installed git-flow -> ");
      });

      const installedFile = platform.path.join(
        getUserSkillsDir(),
        "git-flow",
        "SKILL.md",
      );
      assertStringIncludes(
        await platform.fs.readTextFile(installedFile),
        "name: git-flow",
      );
      const origin = await readSkillOrigin(
        platform.path.join(getUserSkillsDir(), "git-flow"),
      );
      assertEquals(origin?.source, "git");
      assertEquals(origin?.git?.cloneUrl, source);
      assertEquals(typeof origin?.contentHash, "string");
    });
  });
});

Deno.test("skill command: search reads the repository index", async () => {
  await withTempHlvmDir(async () => {
    await withTempDir(async (tempDir) => {
      const platform = getPlatform();
      const indexFile = platform.path.join(tempDir, "index.json");
      await writeSkillRepositoryIndex(indexFile, [
        {
          slug: "phase-search",
          description: "Use when testing repository search.",
          install: "github:owner/repo/skills/phase-search",
          version: "1.2.3",
          license: "MIT",
          tags: ["test", "phase"],
          trust: "official",
        },
      ]);

      await withSkillRepositoryIndex(
        platform.path.toFileUrl(indexFile).href,
        async () => {
          await withCapturedOutput(async (output) => {
            await skillCommand(["search", "phase", "--limit", "5"]);
            assertStringIncludes(output(), "phase-search");
            assertStringIncludes(output(), "1.2.3");
            assertStringIncludes(output(), "official");
          });

          await withCapturedOutput(async (output) => {
            await skillCommand(["search", "phase", "--json"]);
            const parsed = JSON.parse(output());
            assertEquals(parsed.results[0].slug, "phase-search");
          });
        },
      );
    });
  });
});

Deno.test("skill command: install resolves repository slugs through the index", async () => {
  await withTempHlvmDir(async () => {
    await withTempDir(async (tempDir) => {
      const platform = getPlatform();
      const repoDir = platform.path.join(tempDir, "repo");
      await writeSkillFixture(
        platform.path.join(repoDir, "phase-repo"),
        "phase-repo",
        "Use when testing repository install.",
      );
      await runGit(repoDir, ["init"]);
      await runGit(repoDir, ["config", "user.email", "test@example.com"]);
      await runGit(repoDir, ["config", "user.name", "Test User"]);
      await runGit(repoDir, ["add", "."]);
      await runGit(repoDir, ["commit", "-m", "add skill"]);

      const source = platform.path.toFileUrl(repoDir).href;
      const indexFile = platform.path.join(tempDir, "index.json");
      await writeSkillRepositoryIndex(indexFile, [
        {
          slug: "phase-repo",
          description: "Use when testing repository install.",
          install: source,
          version: "latest",
          versions: {
            "1.0.0": source,
          },
          trust: "official",
        },
      ]);

      await withSkillRepositoryIndex(
        platform.path.toFileUrl(indexFile).href,
        async () => {
          await withCapturedOutput(async (output) => {
            await skillCommand(["info", "phase-repo", "--remote"]);
            assertStringIncludes(output(), "Slug:        phase-repo");
            assertStringIncludes(output(), `Install:     ${source}`);
          });

          await withCapturedOutput(async (output) => {
            await skillCommand(["install", "phase-repo", "--version", "1.0.0"]);
            assertStringIncludes(output(), "Installed phase-repo -> ");
          });

          const installedFile = platform.path.join(
            getUserSkillsDir(),
            "phase-repo",
            "SKILL.md",
          );
          assertStringIncludes(
            await platform.fs.readTextFile(installedFile),
            "name: phase-repo",
          );
          const origin = await readSkillOrigin(
            platform.path.join(getUserSkillsDir(), "phase-repo"),
          );
          assertEquals(origin?.source, "git");
          assertEquals(origin?.git?.cloneUrl, source);
        },
      );
    });
  });
});

Deno.test("skill command: remove deletes a global user skill", async () => {
  await withTempHlvmDir(async () => {
    await withCapturedOutput(async () => {
      await skillCommand(["new", "remove-flow"]);
    });

    const platform = getPlatform();
    const skillDir = platform.path.join(getUserSkillsDir(), "remove-flow");
    assertEquals(await platform.fs.exists(skillDir), true);

    await withCapturedOutput(async (output) => {
      await skillCommand(["remove", "remove-flow"]);
      assertStringIncludes(output(), "Removed remove-flow -> ");
    });

    assertEquals(await platform.fs.exists(skillDir), false);
  });
});

Deno.test("skill command: update refreshes a tracked git skill", async () => {
  await withTempHlvmDir(async () => {
    await withTempDir(async (repoDir) => {
      const platform = getPlatform();
      const skillDir = platform.path.join(repoDir, "git-update");
      await writeSkillFixture(skillDir, "git-update", "Original git update.");
      await runGit(repoDir, ["init"]);
      await runGit(repoDir, ["config", "user.email", "test@example.com"]);
      await runGit(repoDir, ["config", "user.name", "Test User"]);
      await runGit(repoDir, ["add", "."]);
      await runGit(repoDir, ["commit", "-m", "add skill"]);

      const source = platform.path.toFileUrl(repoDir).href;
      await withCapturedOutput(async () => {
        await skillCommand(["install", source]);
      });

      await writeSkillFixture(
        skillDir,
        "git-update",
        "Replacement git update.",
      );
      await runGit(repoDir, ["add", "."]);
      await runGit(repoDir, ["commit", "-m", "update skill"]);

      await withCapturedOutput(async (output) => {
        await skillCommand(["update", "git-update"]);
        assertStringIncludes(output(), "Updated git-update -> ");
      });

      await withCapturedOutput(async (output) => {
        await skillCommand(["info", "git-update"]);
        assertStringIncludes(output(), "Replacement git update.");
        assertStringIncludes(output(), "Origin:      git ");
        assertStringIncludes(output(), "Content hash: ");
      });

      const installedFile = platform.path.join(
        getUserSkillsDir(),
        "git-update",
        "SKILL.md",
      );
      await platform.fs.writeTextFile(
        installedFile,
        `${await platform.fs.readTextFile(installedFile)}\nLocal dirty edit.\n`,
      );

      await withCapturedOutput(async (output) => {
        await skillCommand(["update", "git-update"]);
        assertStringIncludes(output(), "Updated git-update -> ");
      });
      const restored = await platform.fs.readTextFile(installedFile);
      assertEquals(restored.includes("Local dirty edit."), false);
    });
  });
});

Deno.test("skill command: update --all reports no tracked skills when none exist", async () => {
  await withTempHlvmDir(async () => {
    await withCapturedOutput(async (output) => {
      await skillCommand(["update", "--all"]);
      assertStringIncludes(output(), "No tracked skills to update.");
    });
  });
});

Deno.test("skill command: check reports ready skills and local warnings", async () => {
  await withTempHlvmDir(async () => {
    await withCapturedOutput(async () => {
      await skillCommand(["new", "check-flow"]);
    });

    await withCapturedOutput(async (output) => {
      await skillCommand(["check"]);
      assertStringIncludes(output(), "Skills Status Check");
      assertStringIncludes(output(), "check-flow (user)");
      assertStringIncludes(
        output(),
        "warning: No origin metadata; update cannot track this skill.",
      );
      assertStringIncludes(output(), "debug (bundled)");
    });

    await withCapturedOutput(async (output) => {
      await skillCommand(["check", "--json"]);
      const parsed = JSON.parse(output());
      assertEquals(typeof parsed.total, "number");
      assertEquals(
        parsed.entries.some((entry: { name: string }) =>
          entry.name === "check-flow"
        ),
        true,
      );
    });
  });
});

Deno.test("skill command: check returns non-zero for invalid skills", async () => {
  await withTempHlvmDir(async () => {
    const platform = getPlatform();
    const skillDir = platform.path.join(getUserSkillsDir(), "broken-flow");
    await platform.fs.mkdir(skillDir, { recursive: true });
    await platform.fs.writeTextFile(
      platform.path.join(skillDir, "SKILL.md"),
      "---\nname: wrong-name\ndescription: broken\n---\n",
    );

    let code: void | number | undefined;
    await withCapturedOutput(async (output) => {
      code = await skillCommand(["check"]);
      assertStringIncludes(output(), "error");
      assertStringIncludes(output(), "broken-flow (user)");
    });
    assertEquals(code, 1);
  });
});
