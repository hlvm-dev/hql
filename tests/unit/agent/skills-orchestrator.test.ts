import { assertEquals, assertStringIncludes } from "jsr:@std/assert@1";
import { getUserSkillsDir } from "../../../src/common/paths.ts";
import {
  ContextManager,
  type Message,
} from "../../../src/hlvm/agent/context.ts";
import { runReActLoop } from "../../../src/hlvm/agent/orchestrator.ts";
import type { LLMFunction } from "../../../src/hlvm/agent/orchestrator-llm.ts";
import { getPlatform } from "../../../src/platform/platform.ts";
import { withTempDir, withTempHlvmDir } from "../helpers.ts";

async function writeUserSkill(): Promise<void> {
  const platform = getPlatform();
  const dir = platform.path.join(getUserSkillsDir(), "debug");
  await platform.fs.mkdir(dir, { recursive: true });
  await platform.fs.writeTextFile(
    platform.path.join(dir, "SKILL.md"),
    `---
name: debug
description: Investigate failures from symptoms to root cause.
---

Use the debug workflow.
`,
  );
}

Deno.test("orchestrator: injects available skills before the LLM call", async () => {
  await withTempHlvmDir(async () => {
    await withTempDir(async (workspace) => {
      await writeUserSkill();
      const context = new ContextManager();
      let capturedMessages: Message[] = [];
      const llm: LLMFunction = (messages) => {
        capturedMessages = messages;
        return Promise.resolve({ content: "done", toolCalls: [] });
      };

      const result = await runReActLoop("debug the failing test", {
        workspace,
        context,
        maxIterations: 1,
      }, llm);

      assertEquals(result.text, "done");
      const joined = capturedMessages.map((message) => message.content).join(
        "\n",
      );
      assertStringIncludes(joined, "<available_skills>");
      assertStringIncludes(joined, "<name>debug</name>");
      assertStringIncludes(
        joined,
        "Investigate failures from symptoms to root cause.",
      );
      assertStringIncludes(joined, "SKILL.md");
      assertEquals(joined.includes("Use the debug workflow."), false);
    });
  });
});

Deno.test("orchestrator: refreshes one skills prompt across persistent turns", async () => {
  await withTempHlvmDir(async () => {
    await withTempDir(async (workspace) => {
      await writeUserSkill();
      const context = new ContextManager();
      const llm: LLMFunction = () =>
        Promise.resolve({ content: "done", toolCalls: [] });

      await runReActLoop("debug the failing test", {
        workspace,
        context,
        maxIterations: 1,
      }, llm);
      await runReActLoop("debug the next failure", {
        workspace,
        context,
        maxIterations: 1,
      }, llm);

      const skillPromptCount = context.getMessages().filter((message) =>
        message.role === "system" &&
        message.content.includes("<available_skills>")
      ).length;
      assertEquals(skillPromptCount, 1);
    });
  });
});
