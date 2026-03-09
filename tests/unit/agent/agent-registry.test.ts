import { assertEquals, assertRejects } from "jsr:@std/assert";
import { getAgentProfile, loadAgentProfiles } from "../../../src/hlvm/agent/agent-registry.ts";
import { getPlatform } from "../../../src/platform/platform.ts";

async function withWorkspace(
  fn: (workspace: string) => Promise<void>,
): Promise<void> {
  const platform = getPlatform();
  const workspace = await platform.fs.makeTempDir({
    prefix: "hlvm-agent-registry-",
  });
  try {
    await fn(workspace);
  } finally {
    await platform.fs.remove(workspace, { recursive: true });
  }
}

Deno.test("agent registry: loads project teammates from .hlvm/agents markdown", async () => {
  await withWorkspace(async (workspace) => {
    const platform = getPlatform();
    const agentsDir = platform.path.join(workspace, ".hlvm/agents");
    await platform.fs.mkdir(agentsDir, { recursive: true });
    await platform.fs.writeTextFile(
      platform.path.join(agentsDir, "reviewer.md"),
      `---
name: reviewer
description: Reviews changes with a fresh perspective
tools:
  - read_file
  - search_code
temperature: 0.1
maxTokens: 2048
---
Focus on regressions, edge cases, and missing tests.
`,
    );

    const profiles = await loadAgentProfiles(workspace, {
      toolValidator: (tool) => tool === "read_file" || tool === "search_code",
    });
    const profile = getAgentProfile("reviewer", profiles);

    assertEquals(profile?.description, "Reviews changes with a fresh perspective");
    assertEquals(profile?.temperature, 0.1);
    assertEquals(profile?.maxTokens, 2048);
    assertEquals(
      profile?.instructions,
      "Focus on regressions, edge cases, and missing tests.",
    );
  });
});

Deno.test("agent registry: rejects project teammates that duplicate built-in names", async () => {
  await withWorkspace(async (workspace) => {
    const platform = getPlatform();
    const agentsDir = platform.path.join(workspace, ".hlvm/agents");
    await platform.fs.mkdir(agentsDir, { recursive: true });
    await platform.fs.writeTextFile(
      platform.path.join(agentsDir, "code.md"),
      `---
name: code
description: Duplicate built-in
tools:
  - read_file
---
`,
    );

    await assertRejects(
      () =>
        loadAgentProfiles(workspace, {
          toolValidator: (tool) => tool === "read_file",
        }),
      Error,
      "duplicates a built-in agent profile",
    );
  });
});

Deno.test("agent registry: rejects project teammates with unknown tools", async () => {
  await withWorkspace(async (workspace) => {
    const platform = getPlatform();
    const agentsDir = platform.path.join(workspace, ".hlvm/agents");
    await platform.fs.mkdir(agentsDir, { recursive: true });
    await platform.fs.writeTextFile(
      platform.path.join(agentsDir, "unknown-tool.md"),
      `---
name: reviewer
description: Invalid tool
tools:
  - definitely_not_a_tool
---
`,
    );

    await assertRejects(
      () =>
        loadAgentProfiles(workspace, {
          toolValidator: () => false,
        }),
      Error,
      "uses unknown tools",
    );
  });
});
