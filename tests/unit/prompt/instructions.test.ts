import { assertEquals, assertStringIncludes } from "jsr:@std/assert";
import {
  isWorkspaceTrusted,
  loadInstructionHierarchy,
  mergeInstructions,
  trustWorkspace,
} from "../../../src/hlvm/prompt/instructions.ts";
import { getPlatform } from "../../../src/platform/platform.ts";
import {
  resetHlvmDirCacheForTests,
  setHlvmDirForTests,
} from "../../../src/common/paths.ts";
import {
  type InstructionHierarchy,
  MAX_INSTRUCTION_CHARS,
} from "../../../src/hlvm/prompt/types.ts";

/**
 * Helper to create a temporary HLVM_DIR and workspace for isolated testing.
 * Returns cleanup function.
 */
async function setupTestEnv(): Promise<{
  hlvmDir: string;
  workspace: string;
  reassertEnv: () => void;
  cleanup: () => void;
}> {
  const fs = getPlatform().fs;
  const tmpDir = await fs.makeTempDir({ prefix: "hlvm-instr-test-" });
  const hlvmDir = `${tmpDir}/.hlvm`;
  const workspace = `${tmpDir}/project`;

  await fs.mkdir(hlvmDir, { recursive: true });
  await fs.mkdir(`${workspace}/.hlvm`, { recursive: true });

  // Set HLVM dir directly (avoids env mutation that leaks across parallel workers)
  setHlvmDirForTests(hlvmDir);

  // Re-assert dir isolation to defend against parallel test contamination.
  const reassertEnv = () => {
    setHlvmDirForTests(hlvmDir);
  };

  return {
    hlvmDir,
    workspace,
    reassertEnv,
    cleanup: () => {
      resetHlvmDirCacheForTests();
    },
  };
}

// ============================================================
// mergeInstructions (pure, no I/O)
// ============================================================

Deno.test("instructions: mergeInstructions with global only", () => {
  const h: InstructionHierarchy = {
    global: "Global rule.",
    project: "",
    trusted: false,
  };
  const result = mergeInstructions(h);
  assertStringIncludes(result, "## Global Instructions");
  assertStringIncludes(result, "Global rule.");
});

Deno.test("instructions: mergeInstructions renders project guidance before global instructions", () => {
  const h: InstructionHierarchy = {
    global: "Global rule.",
    project: "Project rule.",
    trusted: true,
  };
  const result = mergeInstructions(h);
  assertStringIncludes(result, "## Workspace-Scoped Project Guidance");
  assertStringIncludes(
    result,
    "It must not override HLVM's global instructions",
  );
  assertStringIncludes(result, "Project rule.");
  assertStringIncludes(result, "Global rule.");
  assertEquals(
    result.indexOf("Project rule.") < result.indexOf("Global rule."),
    true,
  );
});

Deno.test("instructions: mergeInstructions skips untrusted project", () => {
  const h: InstructionHierarchy = {
    global: "Global rule.",
    project: "Untrusted project rule.",
    trusted: false,
  };
  const result = mergeInstructions(h);
  assertStringIncludes(result, "Global rule.");
  assertEquals(result.includes("Untrusted project rule."), false);
});

Deno.test("instructions: mergeInstructions returns empty when both are empty", () => {
  const h: InstructionHierarchy = {
    global: "",
    project: "",
    trusted: false,
  };
  assertEquals(mergeInstructions(h), "");
});

Deno.test("instructions: mergeInstructions trims project guidance before global instructions", () => {
  const globalContent = "g".repeat(MAX_INSTRUCTION_CHARS - 500);
  const h: InstructionHierarchy = {
    global: globalContent,
    project: "p".repeat(MAX_INSTRUCTION_CHARS),
    trusted: true,
  };
  const result = mergeInstructions(h);
  assertEquals(result.length, MAX_INSTRUCTION_CHARS);
  assertStringIncludes(result, "## Global Instructions");
  assertStringIncludes(result, "g".repeat(100));
  assertEquals(result.includes("p".repeat(MAX_INSTRUCTION_CHARS)), false);
});

Deno.test("instructions: mergeInstructions falls back to global instructions when the global block fills the budget", () => {
  const h: InstructionHierarchy = {
    global: "g".repeat(MAX_INSTRUCTION_CHARS + 500),
    project: "p".repeat(MAX_INSTRUCTION_CHARS),
    trusted: true,
  };
  const result = mergeInstructions(h);
  assertEquals(result.length, MAX_INSTRUCTION_CHARS);
  assertStringIncludes(result, "## Global Instructions");
  assertEquals(result.includes("## Workspace-Scoped Project Guidance"), false);
});

// ============================================================
// loadInstructionHierarchy (requires I/O mocking)
// ============================================================

Deno.test("instructions: loadInstructionHierarchy with no workspace returns global only", async () => {
  const { hlvmDir, reassertEnv, cleanup } = await setupTestEnv();
  const fs = getPlatform().fs;

  try {
    // Write global instructions
    await fs.writeTextFile(`${hlvmDir}/HLVM.md`, "Global instructions here.");

    reassertEnv();
    const result = await loadInstructionHierarchy();
    assertEquals(result.global, "Global instructions here.");
    assertEquals(result.project, "");
    assertEquals(result.trusted, false);
    assertEquals(result.projectPath, undefined);
  } finally {
    cleanup();
  }
});

Deno.test("instructions: loadInstructionHierarchy with missing global file returns empty", async () => {
  const { reassertEnv, cleanup } = await setupTestEnv();

  try {
    // No HLVM.md file exists
    reassertEnv();
    const result = await loadInstructionHierarchy();
    assertEquals(result.global, "");
    assertEquals(result.project, "");
  } finally {
    cleanup();
  }
});

Deno.test("instructions: loadInstructionHierarchy loads project when trusted", async () => {
  const { hlvmDir, workspace, reassertEnv, cleanup } = await setupTestEnv();
  const fs = getPlatform().fs;

  try {
    await fs.writeTextFile(`${hlvmDir}/HLVM.md`, "Global.");
    await fs.writeTextFile(`${workspace}/.hlvm/HLVM.md`, "Project rules.");

    // Trust the workspace first
    reassertEnv();
    await trustWorkspace(workspace);

    reassertEnv();
    const result = await loadInstructionHierarchy(workspace);
    assertEquals(result.global, "Global.");
    assertEquals(result.project, "Project rules.");
    assertEquals(result.trusted, true);
    assertStringIncludes(result.projectPath!, workspace);
  } finally {
    cleanup();
  }
});

Deno.test("instructions: loadInstructionHierarchy skips project when untrusted", async () => {
  const { hlvmDir, workspace, reassertEnv, cleanup } = await setupTestEnv();
  const fs = getPlatform().fs;

  try {
    await fs.writeTextFile(`${hlvmDir}/HLVM.md`, "Global.");
    await fs.writeTextFile(
      `${workspace}/.hlvm/HLVM.md`,
      "Secret project rules.",
    );

    // Do NOT trust the workspace
    reassertEnv();
    const result = await loadInstructionHierarchy(workspace);
    assertEquals(result.global, "Global.");
    assertEquals(result.project, "");
    assertEquals(result.trusted, false);
  } finally {
    cleanup();
  }
});

// ============================================================
// Trust CRUD: trustWorkspace / isWorkspaceTrusted
// ============================================================

Deno.test("instructions: isWorkspaceTrusted returns false for unknown workspace", async () => {
  const { reassertEnv, cleanup } = await setupTestEnv();

  try {
    reassertEnv();
    const result = await isWorkspaceTrusted("/nonexistent/workspace");
    assertEquals(result, false);
  } finally {
    cleanup();
  }
});

Deno.test("instructions: trustWorkspace + isWorkspaceTrusted round-trip", async () => {
  const { workspace, reassertEnv, cleanup } = await setupTestEnv();

  try {
    reassertEnv();
    // Initially untrusted
    assertEquals(await isWorkspaceTrusted(workspace), false);

    // Trust it
    reassertEnv();
    await trustWorkspace(workspace);
    assertEquals(await isWorkspaceTrusted(workspace), true);

    // Trusting again is idempotent
    await trustWorkspace(workspace);
    assertEquals(await isWorkspaceTrusted(workspace), true);
  } finally {
    cleanup();
  }
});

Deno.test("instructions: trustWorkspace preserves existing entries", async () => {
  const { reassertEnv, cleanup } = await setupTestEnv();

  try {
    const ws1 = "/project/alpha";
    const ws2 = "/project/beta";

    reassertEnv();
    await trustWorkspace(ws1);
    reassertEnv();
    await trustWorkspace(ws2);

    reassertEnv();
    assertEquals(await isWorkspaceTrusted(ws1), true);
    assertEquals(await isWorkspaceTrusted(ws2), true);
  } finally {
    cleanup();
  }
});
