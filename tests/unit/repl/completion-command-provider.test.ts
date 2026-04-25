import { assertEquals, assertStringIncludes } from "jsr:@std/assert";
import { getUserSkillsDir } from "../../../src/common/paths.ts";
import { getPlatform } from "../../../src/platform/platform.ts";
import { CommandProvider } from "../../../src/hlvm/cli/repl-ink/completion/concrete-providers.ts";
import { buildContext } from "../../../src/hlvm/cli/repl-ink/completion/providers.ts";
import { withTempHlvmDir } from "../helpers.ts";

Deno.test("command completion includes user skills", async () => {
  await withTempHlvmDir(async () => {
    const platform = getPlatform();
    const skillDir = platform.path.join(getUserSkillsDir(), "debug-flow");
    await platform.fs.mkdir(skillDir, { recursive: true });
    await platform.fs.writeTextFile(
      platform.path.join(skillDir, "SKILL.md"),
      `---
name: debug-flow
description: Debug failures before editing code
---

# Debug Flow
`,
    );

    const context = buildContext(
      "/debug",
      "/debug".length,
      new Set(),
      new Map(),
    );
    const result = await CommandProvider.getCompletions(context);
    const skillItem = result.items.find((item) => item.label === "/debug-flow");

    assertEquals(skillItem?.label, "/debug-flow");
    assertStringIncludes(
      skillItem?.description ?? "",
      "Debug failures before editing code",
    );
    const applied = skillItem?.applyAction("SELECT", {
      text: "/debug",
      cursorPosition: "/debug".length,
      anchorPosition: 0,
    });
    assertEquals(applied?.text, "/debug-flow ");
    assertEquals(applied?.sideEffect, undefined);
  });
});

Deno.test("built-in command completion still executes on select", async () => {
  const context = buildContext(
    "/help",
    "/help".length,
    new Set(),
    new Map(),
  );
  const result = await CommandProvider.getCompletions(context);
  const helpItem = result.items.find((item) => item.label === "/help");
  const applied = helpItem?.applyAction("SELECT", {
    text: "/help",
    cursorPosition: "/help".length,
    anchorPosition: 0,
  });

  assertEquals(applied?.text, "/help");
  assertEquals(applied?.sideEffect, { type: "EXECUTE" });
});
