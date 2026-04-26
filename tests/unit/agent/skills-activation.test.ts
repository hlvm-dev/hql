import { assertEquals, assertStringIncludes } from "jsr:@std/assert@1";
import { getUserSkillsDir } from "../../../src/common/paths.ts";
import { resolveSkillSlashInput } from "../../../src/hlvm/agent/skills/activation.ts";
import { getPlatform } from "../../../src/platform/platform.ts";
import { withTempHlvmDir } from "../helpers.ts";

Deno.test("skills activation: resolves slash input to an injected skill prompt", async () => {
  await withTempHlvmDir(async () => {
    const platform = getPlatform();
    const dir = platform.path.join(getUserSkillsDir(), "debug-flow");
    await platform.fs.mkdir(dir, { recursive: true });
    await platform.fs.writeTextFile(
      platform.path.join(dir, "SKILL.md"),
      `---
name: debug-flow
description: Debug failures before editing code.
---

Follow root-cause debugging.
`,
    );

    const activation = await resolveSkillSlashInput(
      "/debug-flow ask hangs after tool output",
    );

    assertEquals(activation?.name, "debug-flow");
    assertEquals(activation?.source, "user");
    assertStringIncludes(
      activation?.prompt ?? "",
      "Use the debug-flow skill for this request.",
    );
    assertStringIncludes(
      activation?.prompt ?? "",
      "Follow root-cause debugging.",
    );
    assertStringIncludes(
      activation?.prompt ?? "",
      "Request: ask hangs after tool output",
    );
  });
});

Deno.test("skills activation: reserved slash commands are not skills", async () => {
  await withTempHlvmDir(async () => {
    assertEquals(await resolveSkillSlashInput("/help"), null);
  });
});
