import {
  assertEquals,
  assertStringIncludes,
} from "jsr:@std/assert";
import { buildCompactionPrompt } from "../../../src/hlvm/agent/compaction-template.ts";
import type { Message } from "../../../src/hlvm/agent/context.ts";

function makeLongText(prefix: string, length: number): string {
  return `${prefix} ${"x".repeat(length)}`;
}

Deno.test("compaction template: includes all sections and preserves user messages verbatim", () => {
  const messages: Message[] = [
    {
      role: "user",
      content: "Please investigate src/hlvm/agent/context.ts and keep this exact note.",
    },
    {
      role: "assistant",
      content: "Reviewed ContextManager and buildMessageGroups.",
    },
    {
      role: "tool",
      content: "Error: diagnostic in src/hlvm/agent/context.ts around buildMessageGroups",
      toolName: "read_file",
    },
  ];

  const prompt = buildCompactionPrompt(messages);

  for (const title of [
    "Primary Request and Intent",
    "Key Technical Concepts",
    "Files and Symbols Referenced",
    "Errors and Debugging",
    "Actions and Problem Solving",
    "User Messages That Must Be Preserved Verbatim",
    "Pending Tasks / Open Questions",
    "Current Work State",
    "Optional Next Step",
  ]) {
    assertStringIncludes(prompt, `## ${title}`);
  }
  assertStringIncludes(
    prompt,
    "- Please investigate src/hlvm/agent/context.ts and keep this exact note.",
  );
});

Deno.test("compaction template: caps assistant and tool excerpts while extracting files and symbols", () => {
  const messages: Message[] = [
    {
      role: "assistant",
      content:
        "Touched src/hlvm/agent/orchestrator.ts and SymbolNameAlpha. " +
        "A".repeat(3_000),
    },
    {
      role: "tool",
      content:
        "Failure in src/common/config/storage.ts with ConfigLoaderBeta. " +
        "B".repeat(2_000),
      toolName: "read_file",
    },
  ];

  const prompt = buildCompactionPrompt(messages);

  assertStringIncludes(prompt, "src/hlvm/agent/orchestrator.ts");
  assertStringIncludes(prompt, "src/common/config/storage.ts");
  assertStringIncludes(prompt, "SymbolNameAlpha");
  assertStringIncludes(prompt, "ConfigLoaderBeta");
  assertEquals(prompt.includes("A".repeat(2_100)), false);
  assertEquals(prompt.includes("B".repeat(1_100)), false);
});
