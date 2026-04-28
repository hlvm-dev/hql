/**
 * Per-turn `findRelevantMemories` tests with the env-var stub.
 *
 * The orchestrator's `maybeInjectRelevantMemories` ultimately calls
 * `findRelevantMemories(...)`. We exercise that selector directly here
 * (the orchestrator-level integration would need a full session boot,
 * which is out of scope for unit tests). The behaviors tested:
 *   - Stub returns 1 file → 1 result returned
 *   - Stub returns 0 files → empty result, no crash
 *   - Stub returns invalid filenames → filtered out
 *   - Stub returns > 5 → capped at 5
 *   - alreadySurfaced filter excludes seeded paths before stub picks
 *   - Failure path: missing stub file path → empty result, never throws
 */

import {
  assert,
  assertEquals,
  assertExists,
} from "jsr:@std/assert";
import { findRelevantMemories } from "../../../src/hlvm/memory/findRelevantMemories.ts";
import { getAutoMemPath } from "../../../src/hlvm/memory/paths.ts";
import { getPlatform } from "../../../src/platform/platform.ts";
import { withTempHlvmDir } from "../helpers.ts";

const ENV_STUB = "HLVM_MEMORY_SELECTOR_STUB";

async function withSelectorStub(
  selectedFilenames: string[],
  fn: () => Promise<void>,
): Promise<void> {
  const env = getPlatform().env;
  const tmp = await getPlatform().fs.makeTempDir({ prefix: "ptr-stub-" });
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

function frontmatter(name: string, desc: string, type = "user"): string {
  return `---\nname: ${name}\ndescription: ${desc}\ntype: ${type}\n---\n\nbody`;
}

Deno.test("[recall 1] stub picks 1 file → 1 result", async () => {
  await withTempHlvmDir(async () => {
    const platform = getPlatform();
    const project = await platform.fs.makeTempDir({ prefix: "ptr1-" });
    try {
      const autoDir = getAutoMemPath(project);
      await platform.fs.mkdir(autoDir, { recursive: true });
      await platform.fs.writeTextFile(
        platform.path.join(autoDir, "topic.md"),
        frontmatter("topic", "the topic"),
      );
      await withSelectorStub(["topic.md"], async () => {
        const ctrl = new AbortController();
        const picks = await findRelevantMemories(
          "tell me",
          autoDir,
          ctrl.signal,
        );
        assertEquals(picks.length, 1);
        assertEquals(picks[0].path.endsWith("topic.md"), true);
        assertExists(picks[0].mtimeMs);
      });
    } finally {
      await platform.fs.remove(project, { recursive: true });
    }
  });
});

Deno.test("[recall 2] empty stub → empty result, no crash", async () => {
  await withTempHlvmDir(async () => {
    const platform = getPlatform();
    const project = await platform.fs.makeTempDir({ prefix: "ptr2-" });
    try {
      const autoDir = getAutoMemPath(project);
      await platform.fs.mkdir(autoDir, { recursive: true });
      await platform.fs.writeTextFile(
        platform.path.join(autoDir, "x.md"),
        frontmatter("x", "x"),
      );
      await withSelectorStub([], async () => {
        const ctrl = new AbortController();
        const picks = await findRelevantMemories("X", autoDir, ctrl.signal);
        assertEquals(picks.length, 0);
      });
    } finally {
      await platform.fs.remove(project, { recursive: true });
    }
  });
});

Deno.test("[recall 3] invalid filenames in stub → filtered out", async () => {
  await withTempHlvmDir(async () => {
    const platform = getPlatform();
    const project = await platform.fs.makeTempDir({ prefix: "ptr3-" });
    try {
      const autoDir = getAutoMemPath(project);
      await platform.fs.mkdir(autoDir, { recursive: true });
      await platform.fs.writeTextFile(
        platform.path.join(autoDir, "real.md"),
        frontmatter("real", "real"),
      );
      await withSelectorStub(
        ["real.md", "../../etc/passwd", "fake.md", "../escape.md"],
        async () => {
          const ctrl = new AbortController();
          const picks = await findRelevantMemories("X", autoDir, ctrl.signal);
          assertEquals(picks.length, 1);
          assertEquals(picks[0].path.endsWith("real.md"), true);
        },
      );
    } finally {
      await platform.fs.remove(project, { recursive: true });
    }
  });
});

Deno.test("[recall 4] stub returns > 5 → capped at 5", async () => {
  await withTempHlvmDir(async () => {
    const platform = getPlatform();
    const project = await platform.fs.makeTempDir({ prefix: "ptr4-" });
    try {
      const autoDir = getAutoMemPath(project);
      await platform.fs.mkdir(autoDir, { recursive: true });
      const filenames: string[] = [];
      for (let i = 0; i < 12; i++) {
        const fn = `t${i}.md`;
        filenames.push(fn);
        await platform.fs.writeTextFile(
          platform.path.join(autoDir, fn),
          frontmatter(`t${i}`, `desc${i}`),
        );
      }
      await withSelectorStub(filenames, async () => {
        const ctrl = new AbortController();
        const picks = await findRelevantMemories("X", autoDir, ctrl.signal);
        assert(picks.length <= 5, `expected ≤5, got ${picks.length}`);
      });
    } finally {
      await platform.fs.remove(project, { recursive: true });
    }
  });
});

Deno.test("[recall 5] alreadySurfaced filter excludes seeded paths before stub picks", async () => {
  await withTempHlvmDir(async () => {
    const platform = getPlatform();
    const project = await platform.fs.makeTempDir({ prefix: "ptr5-" });
    try {
      const autoDir = getAutoMemPath(project);
      await platform.fs.mkdir(autoDir, { recursive: true });
      const aPath = platform.path.join(autoDir, "a.md");
      const bPath = platform.path.join(autoDir, "b.md");
      await platform.fs.writeTextFile(aPath, frontmatter("a", "a"));
      await platform.fs.writeTextFile(bPath, frontmatter("b", "b"));
      // Stub returns both — but `a.md` was already surfaced.
      await withSelectorStub(["a.md", "b.md"], async () => {
        const ctrl = new AbortController();
        const picks = await findRelevantMemories(
          "X",
          autoDir,
          ctrl.signal,
          [],
          new Set([aPath]),
        );
        assertEquals(picks.length, 1);
        assertEquals(picks[0].path.endsWith("b.md"), true);
      });
    } finally {
      await platform.fs.remove(project, { recursive: true });
    }
  });
});

Deno.test("[recall 6] missing stub file path → empty, no throw", async () => {
  await withTempHlvmDir(async () => {
    const platform = getPlatform();
    const project = await platform.fs.makeTempDir({ prefix: "ptr6-" });
    try {
      const autoDir = getAutoMemPath(project);
      await platform.fs.mkdir(autoDir, { recursive: true });
      await platform.fs.writeTextFile(
        platform.path.join(autoDir, "z.md"),
        frontmatter("z", "z"),
      );
      const env = platform.env;
      const prev = env.get(ENV_STUB);
      env.set(ENV_STUB, "/tmp/does-not-exist-stub-999.json");
      try {
        const ctrl = new AbortController();
        const picks = await findRelevantMemories("X", autoDir, ctrl.signal);
        assertEquals(picks.length, 0);
      } finally {
        if (prev !== undefined) env.set(ENV_STUB, prev);
        else env.delete(ENV_STUB);
      }
    } finally {
      await platform.fs.remove(project, { recursive: true });
    }
  });
});
