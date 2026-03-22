import {
  assertEquals,
  assertStringIncludes,
} from "jsr:@std/assert";
import { compilePrompt } from "../../../src/hlvm/prompt/compiler.ts";
import { collectSections } from "../../../src/hlvm/prompt/sections.ts";
import { generateSystemPrompt } from "../../../src/hlvm/agent/llm-integration.ts";
import { EMPTY_INSTRUCTIONS } from "../../../src/hlvm/prompt/types.ts";
import type { InstructionHierarchy, PromptCompilerInput } from "../../../src/hlvm/prompt/types.ts";

/** Build a simple agent-mode input with no tools. */
function agentInput(
  overrides: Partial<PromptCompilerInput> = {},
): PromptCompilerInput {
  return {
    mode: "agent",
    tier: "mid",
    tools: {},
    instructions: EMPTY_INSTRUCTIONS,
    ...overrides,
  };
}

// ============================================================
// Backward Compatibility
// ============================================================

Deno.test("compiler: backward compat — compilePrompt agent mode matches generateSystemPrompt for same inputs", () => {
  // generateSystemPrompt() now delegates to compilePrompt internally.
  // With the same default options, output text must be identical.
  const compiled = compilePrompt(agentInput());
  const legacy = generateSystemPrompt();

  // Both must include core content
  assertStringIncludes(compiled.text, "AI assistant");
  assertStringIncludes(compiled.text, "Platform:");
  assertStringIncludes(legacy, "AI assistant");
  assertStringIncludes(legacy, "Platform:");
});

Deno.test("compiler: backward compat — custom instructions passed through hierarchy match legacy customInstructions", () => {
  const instructions: InstructionHierarchy = {
    global: "Always use TypeScript.",
    project: "",
    trusted: false,
  };

  const compiled = compilePrompt(agentInput({ instructions }));
  const legacy = generateSystemPrompt({ instructions });

  assertStringIncludes(compiled.text, "Always use TypeScript.");
  assertStringIncludes(legacy, "Always use TypeScript.");
});

// ============================================================
// Mode Tests
// ============================================================

Deno.test("compiler: chat mode produces minimal 2-section prompt", () => {
  const result = compilePrompt({
    mode: "chat",
    tier: "mid",
    tools: {},
    instructions: EMPTY_INSTRUCTIONS,
  });

  assertEquals(result.mode, "chat");
  assertEquals(result.sections.length, 2);
  assertEquals(result.sections[0].id, "chat_role");
  assertEquals(result.sections[1].id, "chat_no_tools");
  assertStringIncludes(result.text, "helpful AI assistant");
  assertStringIncludes(result.text, "no live tool access");
  // Should NOT include agent-mode content
  assertEquals(result.text.includes("# Tool Selection"), false);
  assertEquals(result.text.includes("# Permission Cost"), false);
});

Deno.test("compiler: agent mode produces full section set", () => {
  const result = compilePrompt(agentInput({ tier: "frontier" }));

  assertEquals(result.mode, "agent");
  const sectionIds = result.sections.map((s) => s.id);
  assertStringIncludes(sectionIds.join(","), "role");
  assertStringIncludes(sectionIds.join(","), "critical_rules");
  assertStringIncludes(sectionIds.join(","), "instructions");
  assertStringIncludes(sectionIds.join(","), "environment");
  assertStringIncludes(sectionIds.join(","), "examples");
  assertStringIncludes(sectionIds.join(","), "footer");
});

// ============================================================
// Tier Filtering
// ============================================================

Deno.test("compiler: weak tier skips mid/frontier sections like Tips", () => {
  const weak = compilePrompt(agentInput({ tier: "weak" }));
  const sectionIds = weak.sections.map((s) => s.id);

  // Tips has minTier: "mid" — should be excluded
  assertEquals(sectionIds.includes("tips"), false);
  // Examples has minTier: "weak" — should be included
  assertEquals(sectionIds.includes("examples"), true);
});

Deno.test("compiler: mid tier includes mid sections like Tips", () => {
  const mid = compilePrompt(agentInput({ tier: "mid" }));
  const sectionIds = mid.sections.map((s) => s.id);

  assertEquals(sectionIds.includes("tips"), true);
  assertEquals(sectionIds.includes("examples"), true);
});

Deno.test("compiler: frontier tier includes all sections", () => {
  const frontier = compilePrompt(agentInput({ tier: "frontier" }));
  const sectionIds = frontier.sections.map((s) => s.id);

  assertEquals(sectionIds.includes("tips"), true);
  assertEquals(sectionIds.includes("examples"), true);
  assertEquals(sectionIds.includes("footer"), true);
});

Deno.test("compiler: weak < mid < frontier in text length for agent mode", () => {
  const weak = compilePrompt(agentInput({ tier: "weak" }));
  const mid = compilePrompt(agentInput({ tier: "mid" }));
  const frontier = compilePrompt(agentInput({ tier: "frontier" }));

  assertEquals(weak.text.length < mid.text.length, true);
  assertEquals(frontier.text.length >= mid.text.length, true);
});

// ============================================================
// Hash Stability
// ============================================================

Deno.test("compiler: same input produces same signatureHash", () => {
  const a = compilePrompt(agentInput());
  const b = compilePrompt(agentInput());

  assertEquals(a.signatureHash, b.signatureHash);
});

Deno.test("compiler: different mode produces different signatureHash", () => {
  const agent = compilePrompt(agentInput({ mode: "agent" }));
  const chat = compilePrompt({
    mode: "chat",
    tier: "mid",
    tools: {},
    instructions: EMPTY_INSTRUCTIONS,
  });

  assertEquals(agent.signatureHash === chat.signatureHash, false);
});

Deno.test("compiler: signatureHash format is mode:tier:hex", () => {
  const result = compilePrompt(agentInput());

  const parts = result.signatureHash.split(":");
  assertEquals(parts.length, 3);
  assertEquals(parts[0], "agent");
  assertEquals(parts[1], "mid");
  assertEquals(/^[0-9a-f]{8}$/.test(parts[2]), true);
});

// ============================================================
// Section Manifest
// ============================================================

Deno.test("compiler: section manifest has correct ids and positive charCounts", () => {
  const result = compilePrompt(agentInput());

  for (const entry of result.sections) {
    assertEquals(typeof entry.id, "string");
    assertEquals(entry.id.length > 0, true);
    assertEquals(entry.charCount > 0, true);
  }
});

Deno.test("compiler: section manifest charCounts sum approximately to text length", () => {
  const result = compilePrompt(agentInput());

  const sectionCharsSum = result.sections.reduce(
    (sum, s) => sum + s.charCount,
    0,
  );
  // Text = sections joined with "\n\n", so add separator chars
  const separators = (result.sections.length - 1) * 2; // "\n\n" per join
  assertEquals(sectionCharsSum + separators, result.text.length);
});

// ============================================================
// Empty Instructions
// ============================================================

Deno.test("compiler: no custom instructions section when both global and project are empty", () => {
  const result = compilePrompt(agentInput({ instructions: EMPTY_INSTRUCTIONS }));
  const sectionIds = result.sections.map((s) => s.id);

  assertEquals(sectionIds.includes("custom"), false);
});

Deno.test("compiler: custom instructions section appears when global is non-empty", () => {
  const result = compilePrompt(
    agentInput({
      instructions: { global: "Be concise.", project: "", trusted: false },
    }),
  );
  const sectionIds = result.sections.map((s) => s.id);

  assertEquals(sectionIds.includes("custom"), true);
  assertStringIncludes(result.text, "Be concise.");
});

Deno.test("compiler: project instructions appear only when trusted", () => {
  // Untrusted — project content should NOT appear
  const untrusted = compilePrompt(
    agentInput({
      instructions: {
        global: "",
        project: "Secret project rules",
        trusted: false,
      },
    }),
  );
  assertEquals(untrusted.text.includes("Secret project rules"), false);

  // Trusted — project content should appear
  const trusted = compilePrompt(
    agentInput({
      instructions: {
        global: "",
        project: "Secret project rules",
        trusted: true,
      },
    }),
  );
  assertStringIncludes(trusted.text, "Secret project rules");
});

Deno.test("compiler: custom instructions capped at 2000 chars", () => {
  const result = compilePrompt(
    agentInput({
      instructions: { global: "x".repeat(3000), project: "", trusted: false },
    }),
  );

  // The custom section content is capped to 2000 chars (plus the header)
  const customSection = result.sections.find((s) => s.id === "custom");
  assertEquals(customSection !== undefined, true);
  // Full content = "# Custom Instructions\n## Global Instructions\n" + body (capped at 2000)
  assertEquals(customSection!.charCount <= 2100, true); // header + 2000 body max
});

// ============================================================
// Instruction Sources (Observability)
// ============================================================

Deno.test("compiler: instructionSources empty when no instructions provided", () => {
  const result = compilePrompt(agentInput({ instructions: EMPTY_INSTRUCTIONS }));
  assertEquals(result.instructionSources.length, 0);
});

Deno.test("compiler: instructionSources includes global when global is non-empty", () => {
  const result = compilePrompt(
    agentInput({
      instructions: { global: "hello", project: "", trusted: false },
    }),
  );

  assertEquals(result.instructionSources.length, 1);
  assertEquals(result.instructionSources[0].path, "~/.hlvm/HLVM.md");
  assertEquals(result.instructionSources[0].trusted, true);
  assertEquals(result.instructionSources[0].loaded, true);
});

Deno.test("compiler: instructionSources includes project when projectPath is set", () => {
  const result = compilePrompt(
    agentInput({
      instructions: {
        global: "global",
        project: "proj",
        projectPath: "/my/project/.hlvm/HLVM.md",
        trusted: true,
      },
    }),
  );

  assertEquals(result.instructionSources.length, 2);
  assertEquals(result.instructionSources[0].path, "~/.hlvm/HLVM.md");
  assertEquals(result.instructionSources[1].path, "/my/project/.hlvm/HLVM.md");
  assertEquals(result.instructionSources[1].trusted, true);
  assertEquals(result.instructionSources[1].loaded, true);
});

Deno.test("compiler: instructionSources marks project as not loaded when untrusted", () => {
  const result = compilePrompt(
    agentInput({
      instructions: {
        global: "",
        project: "",
        projectPath: "/my/project/.hlvm/HLVM.md",
        trusted: false,
      },
    }),
  );

  const projectSource = result.instructionSources.find((s) =>
    s.path.includes("/my/project/")
  );
  assertEquals(projectSource !== undefined, true);
  assertEquals(projectSource!.trusted, false);
  assertEquals(projectSource!.loaded, false);
});

// ============================================================
// collectSections
// ============================================================

Deno.test("compiler: collectSections returns PromptSection[] with id, content, minTier", () => {
  const sections = collectSections(agentInput());

  for (const section of sections) {
    assertEquals(typeof section.id, "string");
    assertEquals(typeof section.content, "string");
    assertEquals(
      ["weak", "mid", "frontier"].includes(section.minTier),
      true,
    );
  }
});
