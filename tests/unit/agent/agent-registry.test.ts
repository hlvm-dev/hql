import { assertEquals, assertRejects } from "jsr:@std/assert";
import {
  getAgentProfile,
  loadAgentProfiles,
} from "../../../src/hlvm/agent/agent-registry.ts";
import { getPlatform } from "../../../src/platform/platform.ts";

/** Accept-all tool validator for tests that don't care about tool validity. */
const acceptAllTools = () => true;

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

// ============================================================
// Core loading — happy path
// ============================================================

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

Deno.test("agent registry: loads agent with all optional fields filled", async () => {
  await withWorkspace(async (workspace) => {
    const platform = getPlatform();
    const agentsDir = platform.path.join(workspace, ".hlvm/agents");
    await platform.fs.mkdir(agentsDir, { recursive: true });
    await platform.fs.writeTextFile(
      platform.path.join(agentsDir, "full-agent.md"),
      `---
name: full-agent
description: Agent with every optional field set
tools:
  - read_file
  - write_file
model: ollama/llama3.1:8b
temperature: 0.7
maxTokens: 4096
instructions: Frontmatter instructions.
---
Body instructions appended after frontmatter instructions.
`,
    );

    const profiles = await loadAgentProfiles(workspace, {
      toolValidator: acceptAllTools,
    });
    const profile = getAgentProfile("full-agent", profiles);

    assertEquals(profile?.name, "full-agent");
    assertEquals(profile?.description, "Agent with every optional field set");
    assertEquals(profile?.model, "ollama/llama3.1:8b");
    assertEquals(profile?.temperature, 0.7);
    assertEquals(profile?.maxTokens, 4096);
    // instructions combines frontmatter instructions + body
    assertEquals(
      profile?.instructions,
      "Frontmatter instructions.\n\nBody instructions appended after frontmatter instructions.",
    );
    assertEquals(profile?.tools?.includes("read_file"), true);
    assertEquals(profile?.tools?.includes("write_file"), true);
  });
});

// ============================================================
// Validation errors
// ============================================================

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

Deno.test("agent registry: rejects agent with missing name", async () => {
  await withWorkspace(async (workspace) => {
    const platform = getPlatform();
    const agentsDir = platform.path.join(workspace, ".hlvm/agents");
    await platform.fs.mkdir(agentsDir, { recursive: true });
    await platform.fs.writeTextFile(
      platform.path.join(agentsDir, "no-name.md"),
      `---
description: Missing name field
tools:
  - read_file
---
`,
    );

    await assertRejects(
      () => loadAgentProfiles(workspace, { toolValidator: acceptAllTools }),
      Error,
      "missing a non-empty name",
    );
  });
});

Deno.test("agent registry: rejects agent with missing description", async () => {
  await withWorkspace(async (workspace) => {
    const platform = getPlatform();
    const agentsDir = platform.path.join(workspace, ".hlvm/agents");
    await platform.fs.mkdir(agentsDir, { recursive: true });
    await platform.fs.writeTextFile(
      platform.path.join(agentsDir, "no-desc.md"),
      `---
name: no-desc
tools:
  - read_file
---
`,
    );

    await assertRejects(
      () => loadAgentProfiles(workspace, { toolValidator: acceptAllTools }),
      Error,
      "missing a description",
    );
  });
});

Deno.test("agent registry: rejects agent with no tools", async () => {
  await withWorkspace(async (workspace) => {
    const platform = getPlatform();
    const agentsDir = platform.path.join(workspace, ".hlvm/agents");
    await platform.fs.mkdir(agentsDir, { recursive: true });
    await platform.fs.writeTextFile(
      platform.path.join(agentsDir, "no-tools.md"),
      `---
name: no-tools
description: Agent with empty tools list
tools: []
---
`,
    );

    await assertRejects(
      () => loadAgentProfiles(workspace, { toolValidator: acceptAllTools }),
      Error,
      "must declare at least one tool",
    );
  });
});

Deno.test("agent registry: rejects agent with invalid temperature (negative)", async () => {
  await withWorkspace(async (workspace) => {
    const platform = getPlatform();
    const agentsDir = platform.path.join(workspace, ".hlvm/agents");
    await platform.fs.mkdir(agentsDir, { recursive: true });
    await platform.fs.writeTextFile(
      platform.path.join(agentsDir, "bad-temp.md"),
      `---
name: bad-temp
description: Agent with negative temperature
tools:
  - read_file
temperature: -0.5
---
`,
    );

    await assertRejects(
      () => loadAgentProfiles(workspace, { toolValidator: acceptAllTools }),
      Error,
      "invalid temperature",
    );
  });
});

Deno.test("agent registry: rejects agent with invalid temperature (> 2)", async () => {
  await withWorkspace(async (workspace) => {
    const platform = getPlatform();
    const agentsDir = platform.path.join(workspace, ".hlvm/agents");
    await platform.fs.mkdir(agentsDir, { recursive: true });
    await platform.fs.writeTextFile(
      platform.path.join(agentsDir, "hot-temp.md"),
      `---
name: hot-temp
description: Agent with too-high temperature
tools:
  - read_file
temperature: 3.0
---
`,
    );

    await assertRejects(
      () => loadAgentProfiles(workspace, { toolValidator: acceptAllTools }),
      Error,
      "invalid temperature",
    );
  });
});

Deno.test("agent registry: rejects agent with invalid maxTokens (zero)", async () => {
  await withWorkspace(async (workspace) => {
    const platform = getPlatform();
    const agentsDir = platform.path.join(workspace, ".hlvm/agents");
    await platform.fs.mkdir(agentsDir, { recursive: true });
    await platform.fs.writeTextFile(
      platform.path.join(agentsDir, "bad-tokens.md"),
      `---
name: bad-tokens
description: Agent with zero maxTokens
tools:
  - read_file
maxTokens: 0
---
`,
    );

    await assertRejects(
      () => loadAgentProfiles(workspace, { toolValidator: acceptAllTools }),
      Error,
      "invalid maxTokens",
    );
  });
});

Deno.test("agent registry: rejects duplicate project agent names", async () => {
  await withWorkspace(async (workspace) => {
    const platform = getPlatform();
    const agentsDir = platform.path.join(workspace, ".hlvm/agents");
    await platform.fs.mkdir(agentsDir, { recursive: true });
    // Two files with the same agent name
    await platform.fs.writeTextFile(
      platform.path.join(agentsDir, "alpha.md"),
      `---
name: my-agent
description: First agent
tools:
  - read_file
---
`,
    );
    await platform.fs.writeTextFile(
      platform.path.join(agentsDir, "beta.md"),
      `---
name: my-agent
description: Second agent with same name
tools:
  - read_file
---
`,
    );

    await assertRejects(
      () => loadAgentProfiles(workspace, { toolValidator: acceptAllTools }),
      Error,
      "Duplicate project agent profile",
    );
  });
});

// ============================================================
// Fallback / empty paths
// ============================================================

Deno.test("agent registry: no agents directory returns built-in profiles only", async () => {
  await withWorkspace(async (workspace) => {
    // workspace exists but has no .hlvm/agents directory
    const profiles = await loadAgentProfiles(workspace);

    // Should return built-in profiles (general, code, file, shell, web, memory)
    const names = profiles.map((p) => p.name);
    assertEquals(names.includes("general"), true);
    assertEquals(names.includes("code"), true);
    assertEquals(names.includes("file"), true);
    assertEquals(names.includes("shell"), true);
    assertEquals(names.includes("web"), true);
    assertEquals(names.includes("memory"), true);
  });
});

Deno.test("agent registry: no workspace returns built-in profiles only", async () => {
  const profiles = await loadAgentProfiles();

  const names = profiles.map((p) => p.name);
  assertEquals(names.includes("general"), true);
  assertEquals(names.includes("code"), true);
});

Deno.test("agent registry: non-markdown files in agents dir are ignored", async () => {
  await withWorkspace(async (workspace) => {
    const platform = getPlatform();
    const agentsDir = platform.path.join(workspace, ".hlvm/agents");
    await platform.fs.mkdir(agentsDir, { recursive: true });
    // .txt file should be ignored
    await platform.fs.writeTextFile(
      platform.path.join(agentsDir, "notes.txt"),
      "These are just notes, not an agent definition.",
    );
    // .json file should be ignored
    await platform.fs.writeTextFile(
      platform.path.join(agentsDir, "config.json"),
      '{"name": "config"}',
    );

    const profiles = await loadAgentProfiles(workspace, {
      toolValidator: acceptAllTools,
    });
    // Only built-in profiles, no project agents loaded
    const projectProfiles = profiles.filter(
      (p) => !["general", "code", "file", "shell", "web", "memory"].includes(p.name),
    );
    assertEquals(projectProfiles.length, 0);
  });
});

// ============================================================
// Frontmatter edge cases
// ============================================================

Deno.test("agent registry: file without frontmatter is treated as missing fields", async () => {
  await withWorkspace(async (workspace) => {
    const platform = getPlatform();
    const agentsDir = platform.path.join(workspace, ".hlvm/agents");
    await platform.fs.mkdir(agentsDir, { recursive: true });
    // No frontmatter at all — just body text
    await platform.fs.writeTextFile(
      platform.path.join(agentsDir, "no-front.md"),
      "This file has no YAML frontmatter whatsoever.",
    );

    // Should fail because name is missing
    await assertRejects(
      () => loadAgentProfiles(workspace, { toolValidator: acceptAllTools }),
      Error,
      "missing a non-empty name",
    );
  });
});

Deno.test("agent registry: frontmatter with only name but no tools or description", async () => {
  await withWorkspace(async (workspace) => {
    const platform = getPlatform();
    const agentsDir = platform.path.join(workspace, ".hlvm/agents");
    await platform.fs.mkdir(agentsDir, { recursive: true });
    await platform.fs.writeTextFile(
      platform.path.join(agentsDir, "partial.md"),
      `---
name: partial
---
Some body text.
`,
    );

    // Missing description
    await assertRejects(
      () => loadAgentProfiles(workspace, { toolValidator: acceptAllTools }),
      Error,
      "missing a description",
    );
  });
});

// ============================================================
// getAgentProfile — lookup and aliases
// ============================================================

Deno.test("agent registry: getAgentProfile resolves alias 'generalist' to 'general'", () => {
  const profile = getAgentProfile("generalist");
  assertEquals(profile?.name, "general");
});

Deno.test("agent registry: getAgentProfile resolves alias 'general-purpose' to 'general'", () => {
  const profile = getAgentProfile("general-purpose");
  assertEquals(profile?.name, "general");
});

Deno.test("agent registry: getAgentProfile is case-insensitive", () => {
  const profile = getAgentProfile("CODE");
  assertEquals(profile?.name, "code");
});

Deno.test("agent registry: getAgentProfile returns null for unknown name", () => {
  const profile = getAgentProfile("nonexistent-agent");
  assertEquals(profile, null);
});

Deno.test("agent registry: getAgentProfile trims whitespace from name", () => {
  const profile = getAgentProfile("  web  ");
  assertEquals(profile?.name, "web");
});

// ============================================================
// Normalization behavior
// ============================================================

Deno.test("agent registry: name is normalized to lowercase and trimmed", async () => {
  await withWorkspace(async (workspace) => {
    const platform = getPlatform();
    const agentsDir = platform.path.join(workspace, ".hlvm/agents");
    await platform.fs.mkdir(agentsDir, { recursive: true });
    await platform.fs.writeTextFile(
      platform.path.join(agentsDir, "upper.md"),
      `---
name: "  MY-AGENT  "
description: Agent with uppercase name
tools:
  - read_file
---
`,
    );

    const profiles = await loadAgentProfiles(workspace, {
      toolValidator: acceptAllTools,
    });
    const profile = getAgentProfile("my-agent", profiles);
    assertEquals(profile?.name, "my-agent");
  });
});

Deno.test("agent registry: duplicate tools in profile are deduplicated", async () => {
  await withWorkspace(async (workspace) => {
    const platform = getPlatform();
    const agentsDir = platform.path.join(workspace, ".hlvm/agents");
    await platform.fs.mkdir(agentsDir, { recursive: true });
    await platform.fs.writeTextFile(
      platform.path.join(agentsDir, "dedup.md"),
      `---
name: dedup
description: Agent with duplicate tools
tools:
  - read_file
  - read_file
  - search_code
  - search_code
---
`,
    );

    const profiles = await loadAgentProfiles(workspace, {
      toolValidator: acceptAllTools,
    });
    const profile = getAgentProfile("dedup", profiles);
    // normalizeAgentProfile deduplicates via new Set()
    assertEquals(profile?.tools?.length, 2);
    assertEquals(profile?.tools?.includes("read_file"), true);
    assertEquals(profile?.tools?.includes("search_code"), true);
  });
});
