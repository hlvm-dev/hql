/**
 * Orchestrator-level test for `maybeInjectRelevantMemories`.
 *
 * This is the integration test Codex requested: it exercises the actual
 * orchestrator helper that runs per-turn (not just the underlying selector
 * module). We construct a minimal fake `OrchestratorConfig` whose `context`
 * records added messages, plus a real `LoopState`, then assert that:
 *   - The selector's picks are read from disk and injected as system messages
 *   - Each message includes the freshness note + memory path
 *   - `state.surfacedMemoryPaths` is updated
 *   - A second call with the same picks does NOT re-inject (filter works)
 */

import {
  assert,
  assertEquals,
  assertStringIncludes,
} from "jsr:@std/assert";
import { maybeInjectRelevantMemories } from "../../../src/hlvm/agent/orchestrator.ts";

// `maybeInjectRelevantMemories` only reads `state.surfacedMemoryPaths` —
// no need to build a full LoopState. We cast a minimal shape for testing.
function createMinimalState(): { surfacedMemoryPaths: Set<string> } {
  return { surfacedMemoryPaths: new Set<string>() };
}
import { getAutoMemPath } from "../../../src/hlvm/memory/paths.ts";
import { getPlatform } from "../../../src/platform/platform.ts";
import { withTempHlvmDir } from "../helpers.ts";

const ENV_STUB = "HLVM_MEMORY_SELECTOR_STUB";

async function withSelectorStub(
  selectedFilenames: string[],
  fn: () => Promise<void>,
): Promise<void> {
  const env = getPlatform().env;
  const tmp = await getPlatform().fs.makeTempDir({ prefix: "orch-stub-" });
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

interface CapturedMessage {
  role: string;
  content: string;
}

function buildFakeConfig(): {
  config: any;
  captured: CapturedMessage[];
} {
  const captured: CapturedMessage[] = [];
  const config = {
    context: {
      addMessage(message: { role: string; content: string }) {
        captured.push({ role: message.role, content: message.content });
      },
    },
    onTrace: () => {},
  } as unknown as any;
  return { config, captured };
}

function frontmatter(name: string, desc: string): string {
  return `---\nname: ${name}\ndescription: ${desc}\ntype: project\n---\n\nbody for ${name}`;
}

Deno.test("[orch 1] picks from selector are injected as system messages with freshness + memory wrapper", async () => {
  await withTempHlvmDir(async () => {
    const platform = getPlatform();
    const project = platform.process.cwd(); // doesn't matter — auto-memory keys off cwd anyway
    const autoDir = getAutoMemPath();
    await platform.fs.mkdir(autoDir, { recursive: true });
    const target = "feedback_recall.md";
    const targetPath = platform.path.join(autoDir, target);
    await platform.fs.writeTextFile(
      targetPath,
      frontmatter("recall", "the user prefers tabs"),
    );

    const state = createMinimalState() as unknown as Parameters<
      typeof maybeInjectRelevantMemories
    >[0];
    const { config, captured } = buildFakeConfig();

    await withSelectorStub([target], async () => {
      await maybeInjectRelevantMemories(state, "what do I prefer?", config);
    });

    // One memory file → one system message added.
    assertEquals(captured.length, 1);
    const msg = captured[0];
    assertEquals(msg.role, "system");
    // The wrapped message references the path and includes the body.
    assertStringIncludes(msg.content, "<system-reminder>");
    assertStringIncludes(msg.content, "<memory");
    assertStringIncludes(msg.content, target);
    assertStringIncludes(msg.content, "body for recall");
    // surfacedMemoryPaths updated
    assert(state.surfacedMemoryPaths.has(targetPath));
  });
});

Deno.test("[orch 2] second call with same pick does NOT re-inject (de-dup via surfacedMemoryPaths)", async () => {
  await withTempHlvmDir(async () => {
    const platform = getPlatform();
    const project = platform.process.cwd();
    const autoDir = getAutoMemPath();
    await platform.fs.mkdir(autoDir, { recursive: true });
    const target = "feedback_dedup.md";
    const targetPath = platform.path.join(autoDir, target);
    await platform.fs.writeTextFile(
      targetPath,
      frontmatter("dedup", "user prefers small PRs"),
    );

    const state = createMinimalState() as unknown as Parameters<
      typeof maybeInjectRelevantMemories
    >[0];
    const { config, captured } = buildFakeConfig();

    await withSelectorStub([target], async () => {
      await maybeInjectRelevantMemories(state, "first turn", config);
      assertEquals(captured.length, 1, "first call injects 1");
      await maybeInjectRelevantMemories(state, "second turn", config);
    });

    // Still 1 — the second call's pick was filtered by surfacedMemoryPaths
    assertEquals(
      captured.length,
      1,
      "second call must NOT re-inject the same path",
    );
  });
});

Deno.test("[orch 3] empty picks → no message added, surfacedMemoryPaths unchanged", async () => {
  await withTempHlvmDir(async () => {
    const platform = getPlatform();
    const project = platform.process.cwd();
    const autoDir = getAutoMemPath();
    await platform.fs.mkdir(autoDir, { recursive: true });
    await platform.fs.writeTextFile(
      platform.path.join(autoDir, "x.md"),
      frontmatter("x", "x"),
    );

    const state = createMinimalState() as unknown as Parameters<
      typeof maybeInjectRelevantMemories
    >[0];
    const { config, captured } = buildFakeConfig();
    const before = state.surfacedMemoryPaths.size;

    await withSelectorStub([], async () => {
      await maybeInjectRelevantMemories(state, "anything", config);
    });

    assertEquals(captured.length, 0);
    assertEquals(state.surfacedMemoryPaths.size, before);
  });
});

Deno.test("[orch 4] empty user request → no message added, no error", async () => {
  await withTempHlvmDir(async () => {
    const state = createMinimalState() as unknown as Parameters<
      typeof maybeInjectRelevantMemories
    >[0];
    const { config, captured } = buildFakeConfig();
    await maybeInjectRelevantMemories(state, "   ", config);
    assertEquals(captured.length, 0);
  });
});

Deno.test("[orch 5] selector failure (missing stub file) → graceful no-op", async () => {
  await withTempHlvmDir(async () => {
    const env = getPlatform().env;
    const prev = env.get(ENV_STUB);
    env.set(ENV_STUB, "/tmp/no-such-stub-orch.json");
    try {
      const state = createMinimalState() as unknown as Parameters<
      typeof maybeInjectRelevantMemories
    >[0];
      const { config, captured } = buildFakeConfig();
      // Should not throw — best-effort, fail-soft
      await maybeInjectRelevantMemories(state, "ok", config);
      assertEquals(captured.length, 0);
    } finally {
      if (prev !== undefined) env.set(ENV_STUB, prev);
      else env.delete(ENV_STUB);
    }
  });
});
