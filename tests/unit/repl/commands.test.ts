/**
 * Unit tests for REPL slash commands
 */

import { assertEquals, assertStringIncludes } from "jsr:@std/assert@1";
import {
  COMMAND_CATALOG,
  commands,
  getFullCommandCatalog,
  isCommand,
  parseSkillCommandPayload,
  runCommand,
  SKILL_COMMAND_MARKER,
} from "../../../src/hlvm/cli/repl/commands.ts";
import { isReservedSkillName } from "../../../src/hlvm/agent/skills/reserved.ts";
import { ReplState } from "../../../src/hlvm/cli/repl/state.ts";
import { getUserSkillsDir } from "../../../src/common/paths.ts";
import { getPlatform } from "../../../src/platform/platform.ts";
import { withTempHlvmDir } from "../helpers.ts";

Deno.test("isCommand - slash prefix", () => {
  assertEquals(isCommand("/help"), true);
  assertEquals(isCommand("/unknown"), true);
  assertEquals(isCommand("  /help  "), true); // With whitespace
});

Deno.test("isCommand - not a command", () => {
  assertEquals(isCommand("help"), false);
  assertEquals(isCommand("(+ 1 2)"), false);
  assertEquals(isCommand(""), false);
  assertEquals(isCommand("   "), false);
  assertEquals(isCommand(".help"), false); // Dot prefix is not a command
  assertEquals(isCommand("..spread"), false);
  assertEquals(isCommand("...rest"), false);
});

Deno.test("commands registry - has expected commands", () => {
  const expectedCommands = [
    "/help",
    "/flush",
    "/exit",
    "/config",
    "/model",
    "/tasks",
    "/mcp",
  ];

  for (const cmd of expectedCommands) {
    assertEquals(cmd in commands, true, `Missing command: ${cmd}`);
  }
});

Deno.test("commands registry - omits retired legacy commands from the active conversation surface", () => {
  const removedCommands = [
    "/clear",
    "/reset",
    "/bindings",
    "/unbind",
    "/models",
    "/undo",
    "/clear-history",
    "/quickstart",
    "/warnings",
    "/new",
    "/resume",
    "/status",
    "/bg",
    "/skills",
    "/hooks",
    "/init",
    "/commit",
    "/test",
    "/review",
  ];

  for (const cmd of removedCommands) {
    assertEquals(cmd in commands, false, `Unexpected command: ${cmd}`);
  }
});

Deno.test("commands registry - built-in slash names are reserved for skills", () => {
  for (const command of COMMAND_CATALOG) {
    assertEquals(
      isReservedSkillName(command.name.slice(1)),
      true,
      `Slash command should be reserved for skills: ${command.name}`,
    );
  }
});

Deno.test("runCommand - activates user skill as slash command", async () => {
  await withTempHlvmDir(async () => {
    const platform = getPlatform();
    const skillDir = platform.path.join(getUserSkillsDir(), "debug-flow");
    await platform.fs.mkdir(skillDir, { recursive: true });
    await platform.fs.writeTextFile(
      platform.path.join(skillDir, "SKILL.md"),
      `---
name: debug-flow
description: Debug workflow
---

# Debug Flow

Inspect the failing path before changing code.
`,
    );

    const output: string[] = [];
    const result = await runCommand(
      "/debug-flow ask hangs",
      new ReplState(),
      { onOutput: (line) => output.push(line) },
    );

    assertEquals(result.handled, true);
    assertEquals(output.length, 1);
    assertEquals(output[0].startsWith(SKILL_COMMAND_MARKER), true);
    const payload = parseSkillCommandPayload(
      output[0].slice(SKILL_COMMAND_MARKER.length),
    );
    assertEquals(payload.name, "debug-flow");
    assertEquals(payload.source, "user");
    assertStringIncludes(payload.prompt, "Use the debug-flow skill");
    assertStringIncludes(payload.prompt, "Inspect the failing path");
    assertStringIncludes(payload.prompt, "Request: ask hangs");
  });
});

Deno.test("runCommand - built-in slash commands win over colliding skills", async () => {
  await withTempHlvmDir(async () => {
    const platform = getPlatform();
    const skillDir = platform.path.join(getUserSkillsDir(), "help");
    await platform.fs.mkdir(skillDir, { recursive: true });
    await platform.fs.writeTextFile(
      platform.path.join(skillDir, "SKILL.md"),
      `---
name: help
description: Skill that collides with help
---

This body should not be activated.
`,
    );

    const catalog = await getFullCommandCatalog();
    const helpItems = catalog.filter((item) => item.name === "/help");
    assertEquals(helpItems.length, 1);
    assertEquals(helpItems[0].description, "Show help message");

    const output: string[] = [];
    const result = await runCommand(
      "/help now",
      new ReplState(),
      { onOutput: (line) => output.push(line) },
    );

    assertEquals(result.handled, true);
    assertEquals(
      output.some((line) => line.startsWith(SKILL_COMMAND_MARKER)),
      false,
    );
    assertStringIncludes(output.join("\n"), "HLVM REPL Functions");
  });
});

Deno.test("getFullCommandCatalog - includes skills as slash commands", async () => {
  await withTempHlvmDir(async () => {
    const platform = getPlatform();
    const skillDir = platform.path.join(getUserSkillsDir(), "release-check");
    await platform.fs.mkdir(skillDir, { recursive: true });
    await platform.fs.writeTextFile(
      platform.path.join(skillDir, "SKILL.md"),
      `---
name: release-check
description: Release readiness checklist
---

# Release Check
`,
    );

    const catalog = await getFullCommandCatalog();
    const skillCommand = catalog.find((item) => item.name === "/release-check");

    assertEquals(skillCommand?.description, "Release readiness checklist");
  });
});
