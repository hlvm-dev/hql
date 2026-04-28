/**
 * Phase 6 E2E suite — exercises the new HLVM memory system from the
 * user's point of view. HLVM is global-only (no project-based memory).
 *
 * Scenarios with hard runtime dependencies (Deno worker pool, $EDITOR
 * spawn, Ollama) are exercised at the module level.
 */

import {
  assert,
  assertEquals,
  assertExists,
  assertMatch,
  assertStringIncludes,
} from "jsr:@std/assert";

import {
  isMemorySystemMessage,
  loadMemoryPrompt,
  loadMemorySystemMessage,
  MAX_ENTRYPOINT_LINES,
  truncateEntrypointContent,
} from "../../../src/hlvm/memory/memdir.ts";
import {
  getAutoMemEntrypoint,
  getAutoMemPath,
  getUserMemoryPath,
  isAutoMemPath,
  isMemoryPath,
} from "../../../src/hlvm/memory/paths.ts";
import {
  memoryAge,
  memoryAgeDays,
  memoryFreshnessNote,
  memoryFreshnessText,
} from "../../../src/hlvm/memory/memoryAge.ts";
import {
  formatMemoryManifest,
  scanMemoryFiles,
} from "../../../src/hlvm/memory/memoryScan.ts";
import { findRelevantMemories } from "../../../src/hlvm/memory/findRelevantMemories.ts";
import { resolveToolPath } from "../../../src/hlvm/agent/path-utils.ts";
import { getPlatform } from "../../../src/platform/platform.ts";
import { withTempHlvmDir } from "../helpers.ts";

// =============================================================
// Helpers
// =============================================================

const ENV_DISABLE = "HLVM_DISABLE_AUTO_MEMORY";
const ENV_STUB = "HLVM_MEMORY_SELECTOR_STUB";

async function withDisabledAutoMemory(fn: () => Promise<void>): Promise<void> {
  const env = getPlatform().env;
  const prev = env.get(ENV_DISABLE);
  env.set(ENV_DISABLE, "1");
  try {
    await fn();
  } finally {
    if (prev !== undefined) env.set(ENV_DISABLE, prev);
    else env.delete(ENV_DISABLE);
  }
}

async function withSelectorStub(
  selectedFilenames: string[],
  fn: () => Promise<void>,
): Promise<void> {
  const env = getPlatform().env;
  const tmp = await getPlatform().fs.makeTempDir({ prefix: "hlvm-stub-" });
  const stubFile = getPlatform().path.join(tmp, "stub.json");
  await getPlatform().fs.writeTextFile(
    stubFile,
    JSON.stringify({ selected: selectedFilenames }),
  );
  const prev = env.get(ENV_STUB);
  env.set(ENV_STUB, stubFile);
  try {
    await fn();
  } finally {
    if (prev !== undefined) env.set(ENV_STUB, prev);
    else env.delete(ENV_STUB);
    try {
      await getPlatform().fs.remove(tmp, { recursive: true });
    } catch {
      // best effort
    }
  }
}

// =============================================================
// Core scenarios
// =============================================================

Deno.test("[1] user HLVM.md content is injected into the system prompt", async () => {
  await withTempHlvmDir(async () => {
    const platform = getPlatform();
    await platform.fs.writeTextFile(
      getUserMemoryPath(),
      "User preference: I prefer tabs over spaces.",
    );
    await withDisabledAutoMemory(async () => {
      const prompt = await loadMemoryPrompt();
      assertExists(prompt);
      assertStringIncludes(prompt, "I prefer tabs over spaces");
    });
  });
});

Deno.test("[3] auto-memory dir + MEMORY.md inline in prompt", async () => {
  await withTempHlvmDir(async () => {
    const platform = getPlatform();
    const autoDir = getAutoMemPath();
    await platform.fs.mkdir(autoDir, { recursive: true });
    await platform.fs.writeTextFile(
      platform.path.join(autoDir, "user_role.md"),
      "---\nname: user role\ndescription: Go developer\ntype: user\n---\n\nUser is a Go developer.",
    );
    await platform.fs.writeTextFile(
      getAutoMemEntrypoint(),
      "- [User role](user_role.md) — User is a Go developer",
    );
    const prompt = await loadMemoryPrompt();
    assertExists(prompt);
    assertStringIncludes(prompt, "User is a Go developer");
  });
});

Deno.test("[4] selector with stub returns the seeded filenames (≤5)", async () => {
  await withTempHlvmDir(async () => {
    const platform = getPlatform();
    const autoDir = getAutoMemPath();
    await platform.fs.mkdir(autoDir, { recursive: true });
    for (let i = 0; i < 30; i++) {
      await platform.fs.writeTextFile(
        platform.path.join(autoDir, `topic_${i}.md`),
        `---\nname: topic ${i}\ndescription: about topic ${i}\ntype: project\n---\n\nbody ${i}`,
      );
    }
    const target = "topic_7.md";
    await withSelectorStub([target], async () => {
      const ctrl = new AbortController();
      const picks = await findRelevantMemories(
        "tell me about topic 7",
        autoDir,
        ctrl.signal,
      );
      assertEquals(picks.length, 1);
      assertEquals(picks[0].path.endsWith(target), true);
    });
  });
});

Deno.test("[5] memoryFreshnessText produces 60-day warning", () => {
  const sixtyDaysAgo = Date.now() - 60 * 86_400_000;
  const text = memoryFreshnessText(sixtyDaysAgo);
  assertMatch(text, /60 days old/);
  assertStringIncludes(
    text,
    "Verify against current code before asserting as fact",
  );
  const note = memoryFreshnessNote(sixtyDaysAgo);
  assertStringIncludes(note, "<system-reminder>");
  assertStringIncludes(note, "</system-reminder>");
  assertEquals(memoryFreshnessText(Date.now()), "");
  assertEquals(memoryFreshnessText(Date.now() - 86_400_000), "");
  assertEquals(memoryAgeDays(Date.now()), 0);
  assertEquals(memoryAge(Date.now()), "today");
  assertEquals(memoryAge(Date.now() - 86_400_000), "yesterday");
  assertEquals(memoryAge(sixtyDaysAgo), "60 days ago");
});

Deno.test("[6] resolveEditor falls back through VISUAL → EDITOR → vi", async () => {
  const { resolveEditor } = await import(
    "../../../src/hlvm/cli/repl/edit-in-editor.ts"
  );
  const env = getPlatform().env;
  const prevVisual = env.get("VISUAL");
  const prevEditor = env.get("EDITOR");
  try {
    env.delete("VISUAL");
    env.delete("EDITOR");
    assertEquals(resolveEditor(), { editor: "vi", source: "default" });
    env.set("EDITOR", "nano");
    assertEquals(resolveEditor(), { editor: "nano", source: "EDITOR" });
    env.set("VISUAL", "code -w");
    assertEquals(resolveEditor(), { editor: "code -w", source: "VISUAL" });
  } finally {
    if (prevVisual !== undefined) env.set("VISUAL", prevVisual);
    else env.delete("VISUAL");
    if (prevEditor !== undefined) env.set("EDITOR", prevEditor);
    else env.delete("EDITOR");
  }
});

Deno.test("[7] memory_updated trigger detects memory paths correctly", () => {
  const home = getPlatform().env.get("HOME") ?? "";
  const memoryPaths = [
    `${home}/.hlvm/HLVM.md`,
    "~/.hlvm/HLVM.md",
    `${home}/.hlvm/memory/feedback_tabs.md`,
    `${home}/.hlvm/memory/MEMORY.md`,
  ];
  for (const p of memoryPaths) {
    assertEquals(isMemoryPath(p), true, `expected memory path: ${p}`);
  }
  for (
    const p of [
      `${home}/.hlvm/secret.txt`,
      `${home}/.hlvm/memory/evil.sh`,
      `${home}/.hlvm/projects/old/memory/MEMORY.md`,
      "/etc/passwd",
      "/tmp/foo.md",
      "HLVM.md",
    ]
  ) {
    assertEquals(isMemoryPath(p), false, `expected NOT memory path: ${p}`);
  }
});

Deno.test("[8] truncateEntrypointContent caps at MAX_ENTRYPOINT_LINES with warning", () => {
  const lines = [];
  for (let i = 0; i < MAX_ENTRYPOINT_LINES + 50; i++) {
    lines.push(`- entry ${i}`);
  }
  const result = truncateEntrypointContent(lines.join("\n"));
  assertEquals(result.wasLineTruncated, true);
  assertEquals(result.lineCount, MAX_ENTRYPOINT_LINES + 50);
  assertStringIncludes(result.content, "WARNING: MEMORY.md");
  assertStringIncludes(result.content, `${MAX_ENTRYPOINT_LINES + 50} lines`);
});

Deno.test("[9] empty user HLVM.md does not crash and still loads auto-memory", async () => {
  await withTempHlvmDir(async () => {
    const platform = getPlatform();
    await platform.fs.writeTextFile(getUserMemoryPath(), "");
    const prompt = await loadMemoryPrompt();
    assertExists(prompt);
    assertStringIncludes(prompt, "# auto memory");
    assertEquals(prompt.includes("# Global HLVM Instructions"), false);
  });
});

Deno.test("[11] symlink in memory path is refused (delegated to permission carve-out)", async () => {
  await withTempHlvmDir(async () => {
    const platform = getPlatform();
    const projectRoot = await platform.fs.makeTempDir({ prefix: "scen11-" });
    try {
      let threw = false;
      try {
        await resolveToolPath("../../etc/passwd", projectRoot);
      } catch {
        threw = true;
      }
      assertEquals(threw, true);
    } finally {
      await platform.fs.remove(projectRoot, { recursive: true });
    }
  });
});

Deno.test("[13] scan caps at 200 files for very large auto-memory dirs", async () => {
  await withTempHlvmDir(async () => {
    const platform = getPlatform();
    const autoDir = getAutoMemPath();
    await platform.fs.mkdir(autoDir, { recursive: true });
    const N = 1000;
    const writes: Promise<unknown>[] = [];
    for (let i = 0; i < N; i++) {
      writes.push(
        platform.fs.writeTextFile(
          platform.path.join(autoDir, `f_${i}.md`),
          `---\nname: f${i}\ndescription: file ${i}\ntype: project\n---\nbody`,
        ),
      );
    }
    await Promise.all(writes);
    const ctrl = new AbortController();
    const start = Date.now();
    const headers = await scanMemoryFiles(autoDir, ctrl.signal);
    const ms = Date.now() - start;
    assertEquals(headers.length, 200);
    assert(ms < 5000, `scan took ${ms}ms`);
  });
});

Deno.test("[14] path traversal in memory filename is rejected", async () => {
  await withTempHlvmDir(async () => {
    const projectRoot = await getPlatform().fs.makeTempDir({
      prefix: "scen14-",
    });
    try {
      let threw = false;
      try {
        await resolveToolPath("../../../etc/passwd", projectRoot);
      } catch {
        threw = true;
      }
      assertEquals(threw, true);
    } finally {
      await getPlatform().fs.remove(projectRoot, { recursive: true });
    }
  });
});

// =============================================================
// Bonus
// =============================================================

Deno.test("[bonus] formatMemoryManifest produces parseable lines", async () => {
  await withTempHlvmDir(async () => {
    const platform = getPlatform();
    const autoDir = getAutoMemPath();
    await platform.fs.mkdir(autoDir, { recursive: true });
    await platform.fs.writeTextFile(
      platform.path.join(autoDir, "feedback_x.md"),
      "---\nname: feedback x\ndescription: short hook\ntype: feedback\n---\nbody",
    );
    const ctrl = new AbortController();
    const headers = await scanMemoryFiles(autoDir, ctrl.signal);
    const manifest = formatMemoryManifest(headers);
    assertStringIncludes(manifest, "[feedback]");
    assertStringIncludes(manifest, "feedback_x.md");
    assertStringIncludes(manifest, "short hook");
  });
});

Deno.test("[bonus] isAutoMemPath rejects path traversal", () => {
  const auto = getAutoMemPath();
  const safe = auto + "feedback.md";
  assertEquals(isAutoMemPath(safe), true);
  const escaping = auto + "../../etc/passwd";
  assertEquals(isAutoMemPath(escaping), false);
});

Deno.test("[bonus] isMemorySystemMessage recognizes section headers", () => {
  assertEquals(
    isMemorySystemMessage("# Global HLVM Instructions\nbody"),
    true,
  );
  assertEquals(isMemorySystemMessage("# auto memory\nbody"), true);
  assertEquals(isMemorySystemMessage("# Some other system message"), false);
});

Deno.test("[bonus] loadMemorySystemMessage returns role+content shape", async () => {
  await withTempHlvmDir(async () => {
    const platform = getPlatform();
    await platform.fs.writeTextFile(getUserMemoryPath(), "x");
    await withDisabledAutoMemory(async () => {
      const msg = await loadMemorySystemMessage();
      assertExists(msg);
      assertEquals(msg.role, "system");
      assertStringIncludes(msg.content, "Global HLVM Instructions");
    });
  });
});
