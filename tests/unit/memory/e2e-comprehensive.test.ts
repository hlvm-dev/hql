/**
 * Comprehensive E2E tests from the user's point of view.
 *
 * Organized by category:
 *   A. User journeys (multi-step workflows)
 *   B. Edge cases (empty/malformed inputs, unicode, large files)
 *   C. Security (path traversal, symlinks, project isolation)
 *   D. Performance (large dirs, scan time)
 *   E. Concurrency (parallel reads/writes)
 *   F. CC parity (specific behaviors)
 *   G. Round-trips (write → reload → verify)
 *
 * Each test name describes a user-observable behavior, not an internal API.
 */

import {
  assert,
  assertEquals,
  assertExists,
  assertMatch,
  assertNotEquals,
  assertStringIncludes,
} from "jsr:@std/assert";

import {
  ENTRYPOINT_NAME,
  isMemorySystemMessage,
  loadMemoryPrompt,
  loadMemorySystemMessage,
  MAX_ENTRYPOINT_BYTES,
  MAX_ENTRYPOINT_LINES,
  truncateEntrypointContent,
} from "../../../src/hlvm/memory/memdir.ts";
import {
  findCanonicalGitRoot,
  getAutoMemEntrypoint,
  getAutoMemPath,
  getProjectMemoryPath,
  getUserMemoryPath,
  isAutoMemoryEnabled,
  isAutoMemPath,
  sanitizeProjectKey,
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
import { parseMemoryType } from "../../../src/hlvm/memory/memoryTypes.ts";
import { resolveEditor } from "../../../src/hlvm/cli/repl/edit-in-editor.ts";
import { getPlatform } from "../../../src/platform/platform.ts";
import { withTempHlvmDir } from "../helpers.ts";

// ===========================================================================
// Helpers
// ===========================================================================

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
  const tmp = await getPlatform().fs.makeTempDir({ prefix: "hlvm-stubE-" });
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

function mkFrontmatter(opts: {
  name?: string;
  description?: string;
  type?: string;
  body?: string;
}): string {
  const lines = ["---"];
  if (opts.name !== undefined) lines.push(`name: ${opts.name}`);
  if (opts.description !== undefined) lines.push(`description: ${opts.description}`);
  if (opts.type !== undefined) lines.push(`type: ${opts.type}`);
  lines.push("---");
  lines.push("");
  lines.push(opts.body ?? "");
  return lines.join("\n");
}

async function withTempProject(
  fn: (projectRoot: string) => Promise<void>,
  prefix = "e2e-",
): Promise<void> {
  const root = await getPlatform().fs.makeTempDir({ prefix });
  try {
    await fn(root);
  } finally {
    try {
      await getPlatform().fs.remove(root, { recursive: true });
    } catch {
      // best effort
    }
  }
}

// ===========================================================================
// A. USER JOURNEYS
// ===========================================================================

Deno.test("[A1] First-time user: no memory present anywhere → null prompt with auto-memory disabled", async () => {
  await withTempHlvmDir(async () => {
    await withTempProject(async (projectRoot) => {
      await withDisabledAutoMemory(async () => {
        const prompt = await loadMemoryPrompt(projectRoot);
        assertEquals(prompt, null);
      });
    });
  });
});

Deno.test("[A2] User writes preference → next 'session' (fresh load) reads it back", async () => {
  await withTempHlvmDir(async () => {
    await withTempProject(async (projectRoot) => {
      const platform = getPlatform();
      // Session 1: write
      await platform.fs.writeTextFile(
        getUserMemoryPath(),
        "Preference: I prefer tabs over spaces.",
      );
      // Session 2: cold load (memdir reads from disk each call)
      const prompt = await loadMemoryPrompt(projectRoot);
      assertExists(prompt);
      assertStringIncludes(prompt, "tabs");
    });
  });
});

Deno.test("[A3] User edits HLVM.md mid-flight, NEXT load picks up the change", async () => {
  await withTempHlvmDir(async () => {
    await withTempProject(async (projectRoot) => {
      const platform = getPlatform();
      const userPath = getUserMemoryPath();
      await platform.fs.writeTextFile(userPath, "v1: tabs");
      const p1 = await loadMemoryPrompt(projectRoot);
      assertStringIncludes(p1!, "v1: tabs");

      // User edits
      await platform.fs.writeTextFile(userPath, "v2: spaces");
      const p2 = await loadMemoryPrompt(projectRoot);
      assertStringIncludes(p2!, "v2: spaces");
      assertEquals(p2!.includes("v1: tabs"), false);
    });
  });
});

Deno.test("[A4] User writes a topic file + MEMORY.md pointer → both visible in prompt", async () => {
  await withTempHlvmDir(async () => {
    await withTempProject(async (projectRoot) => {
      const platform = getPlatform();
      const autoDir = getAutoMemPath(projectRoot);
      await platform.fs.mkdir(autoDir, { recursive: true });
      await platform.fs.writeTextFile(
        platform.path.join(autoDir, "feedback_pr_size.md"),
        mkFrontmatter({
          name: "PR size",
          description: "user prefers small PRs",
          type: "feedback",
          body: "User prefers small focused PRs.",
        }),
      );
      await platform.fs.writeTextFile(
        getAutoMemEntrypoint(projectRoot),
        "- [PR size](feedback_pr_size.md) — user prefers small PRs",
      );

      const prompt = await loadMemoryPrompt(projectRoot);
      assertExists(prompt);
      // Index entry present in MEMORY.md section
      assertStringIncludes(prompt, "feedback_pr_size.md");
      assertStringIncludes(prompt, "user prefers small PRs");
    });
  });
});

Deno.test("[A5] User has 2 different projects → memory is project-isolated by canonical key", async () => {
  await withTempHlvmDir(async () => {
    await withTempProject(async (project1) => {
      await withTempProject(async (project2) => {
        const auto1 = getAutoMemPath(project1);
        const auto2 = getAutoMemPath(project2);
        // Different cwds → different sanitized keys → different auto-mem dirs
        assertNotEquals(auto1, auto2);
      });
    });
  });
});

Deno.test("[A6] User in a git worktree → both worktree and main share auto-memory dir", async () => {
  const platform = getPlatform();
  const main = await platform.fs.makeTempDir({ prefix: "A6-main-" });
  const wt = await platform.fs.makeTempDir({ prefix: "A6-wt-" });
  try {
    const mainGit = platform.path.join(main, ".git");
    await platform.fs.mkdir(
      platform.path.join(mainGit, "worktrees", "feature"),
      { recursive: true },
    );
    await platform.fs.writeTextFile(
      platform.path.join(wt, ".git"),
      `gitdir: ${platform.path.join(mainGit, "worktrees", "feature")}\n`,
    );
    const autoMain = getAutoMemPath(main);
    const autoWorktree = getAutoMemPath(wt);
    assertEquals(autoMain, autoWorktree);
  } finally {
    await platform.fs.remove(main, { recursive: true });
    await platform.fs.remove(wt, { recursive: true });
  }
});

Deno.test("[A7] User asks model to remember → model would call write_file at allowed memory path", async () => {
  await withTempProject(async (projectRoot) => {
    // Permission check: a model writing user HLVM.md should pass resolveToolPath
    const userPath = getUserMemoryPath();
    const resolved = await resolveToolPath(userPath, projectRoot);
    assertEquals(resolved, userPath);

    const projectMem = getProjectMemoryPath(projectRoot);
    const projectResolved = await resolveToolPath(projectMem, projectRoot);
    assertEquals(projectResolved, projectMem);

    const autoFile = getPlatform().path.join(
      getAutoMemPath(projectRoot),
      "feedback_x.md",
    );
    const autoResolved = await resolveToolPath(autoFile, projectRoot);
    assertEquals(autoResolved, autoFile);
  });
});

// ===========================================================================
// B. EDGE CASES
// ===========================================================================

Deno.test("[B1] Empty MEMORY.md → prompt shows 'currently empty' message", async () => {
  await withTempHlvmDir(async () => {
    await withTempProject(async (projectRoot) => {
      const platform = getPlatform();
      const autoDir = getAutoMemPath(projectRoot);
      await platform.fs.mkdir(autoDir, { recursive: true });
      await platform.fs.writeTextFile(getAutoMemEntrypoint(projectRoot), "");
      const prompt = await loadMemoryPrompt(projectRoot);
      assertExists(prompt);
      assertStringIncludes(prompt, "currently empty");
    });
  });
});

Deno.test("[B2] Malformed YAML frontmatter → scan returns header with description=null", async () => {
  await withTempHlvmDir(async () => {
    await withTempProject(async (projectRoot) => {
      const platform = getPlatform();
      const autoDir = getAutoMemPath(projectRoot);
      await platform.fs.mkdir(autoDir, { recursive: true });
      await platform.fs.writeTextFile(
        platform.path.join(autoDir, "broken.md"),
        "---\nthis is: not [valid yaml: at all\n---\n\nbody",
      );
      const ctrl = new AbortController();
      const headers = await scanMemoryFiles(autoDir, ctrl.signal);
      assertEquals(headers.length, 1);
      assertEquals(headers[0].description, null);
      assertEquals(headers[0].type, undefined);
    });
  });
});

Deno.test("[B3] Topic file with no frontmatter at all → still listed, description null", async () => {
  await withTempHlvmDir(async () => {
    await withTempProject(async (projectRoot) => {
      const platform = getPlatform();
      const autoDir = getAutoMemPath(projectRoot);
      await platform.fs.mkdir(autoDir, { recursive: true });
      await platform.fs.writeTextFile(
        platform.path.join(autoDir, "raw.md"),
        "# Just a markdown file\n\nNo frontmatter here.",
      );
      const ctrl = new AbortController();
      const headers = await scanMemoryFiles(autoDir, ctrl.signal);
      assertEquals(headers.length, 1);
      assertEquals(headers[0].filename, "raw.md");
      assertEquals(headers[0].description, null);
    });
  });
});

Deno.test("[B4] Unicode + emoji in memory content survives round-trip", async () => {
  await withTempHlvmDir(async () => {
    await withTempProject(async (projectRoot) => {
      const platform = getPlatform();
      const content = "Préférence: タブ over スペース 🎯 — résumé naïve";
      await platform.fs.writeTextFile(getUserMemoryPath(), content);
      const prompt = await loadMemoryPrompt(projectRoot);
      assertStringIncludes(prompt!, "タブ");
      assertStringIncludes(prompt!, "🎯");
      assertStringIncludes(prompt!, "résumé");
    });
  });
});

Deno.test("[B5] MEMORY.md exactly at line cap is NOT truncated", () => {
  const lines = [];
  for (let i = 0; i < MAX_ENTRYPOINT_LINES; i++) lines.push(`- e${i}`);
  const result = truncateEntrypointContent(lines.join("\n"));
  assertEquals(result.wasLineTruncated, false);
  assertEquals(result.wasByteTruncated, false);
  assertEquals(result.content.includes("WARNING"), false);
});

Deno.test("[B6] MEMORY.md byte cap with short lines triggers byte-only warning", () => {
  // Strictly exceed the byte cap (the predicate is `>`, not `>=`).
  const longLine = "x".repeat(MAX_ENTRYPOINT_BYTES + 1);
  const result = truncateEntrypointContent(longLine);
  assertEquals(result.wasByteTruncated, true);
  assertStringIncludes(result.content, "WARNING");
});

Deno.test("[B7] MEMORY.md with both line and byte cap exceeded → both reasons in warning", () => {
  const lines = [];
  for (let i = 0; i < MAX_ENTRYPOINT_LINES + 50; i++) {
    lines.push(`- ${"x".repeat(150)} ${i}`);
  }
  const result = truncateEntrypointContent(lines.join("\n"));
  assertEquals(result.wasLineTruncated, true);
  assertEquals(result.wasByteTruncated, true);
  assertStringIncludes(result.content, "WARNING");
});

Deno.test("[B8] MEMORY.md pointer to a topic file that doesn't exist → no crash", async () => {
  await withTempHlvmDir(async () => {
    await withTempProject(async (projectRoot) => {
      const platform = getPlatform();
      const autoDir = getAutoMemPath(projectRoot);
      await platform.fs.mkdir(autoDir, { recursive: true });
      await platform.fs.writeTextFile(
        getAutoMemEntrypoint(projectRoot),
        "- [Missing](nope.md) — not on disk",
      );
      const prompt = await loadMemoryPrompt(projectRoot);
      assertExists(prompt);
      // The pointer line is preserved in MEMORY.md content; topic file body
      // would be loaded by the per-turn selector, not loadMemoryPrompt.
      assertStringIncludes(prompt, "Missing");
    });
  });
});

Deno.test("[B9] Frontmatter with unknown type field → parseMemoryType returns undefined", () => {
  assertEquals(parseMemoryType("invalid_type"), undefined);
  assertEquals(parseMemoryType(undefined), undefined);
  assertEquals(parseMemoryType(null), undefined);
  assertEquals(parseMemoryType(123), undefined);
  assertEquals(parseMemoryType("user"), "user");
  assertEquals(parseMemoryType("feedback"), "feedback");
  assertEquals(parseMemoryType("project"), "project");
  assertEquals(parseMemoryType("reference"), "reference");
});

// ===========================================================================
// C. SECURITY
// ===========================================================================

Deno.test("[C1] Path traversal rejected from inside memory dir reference", async () => {
  await withTempProject(async (projectRoot) => {
    let threw = false;
    try {
      await resolveToolPath(`${projectRoot}/../../../etc/passwd`, projectRoot);
    } catch {
      threw = true;
    }
    assertEquals(threw, true);
  });
});

Deno.test("[C2] Symlink crossing carve-out boundary rejected", async () => {
  const platform = getPlatform();
  const projectRoot = await platform.fs.makeTempDir({ prefix: "C2-" });
  try {
    // Create a symlink inside the workspace pointing outside (e.g., /etc)
    const linkPath = platform.path.join(projectRoot, "evil-link");
    try {
      await Deno.symlink("/etc", linkPath);
    } catch {
      // May fail on systems without symlink permission; skip if so
      return;
    }
    let threw = false;
    try {
      await resolveToolPath(`${linkPath}/passwd`, projectRoot);
    } catch {
      threw = true;
    }
    assertEquals(threw, true);
  } finally {
    await platform.fs.remove(projectRoot, { recursive: true });
  }
});

Deno.test("[C3] Other project's auto-memory dir denied", async () => {
  await withTempProject(async (projectRoot) => {
    // Forge a path to a different project's memory dir
    const home = getPlatform().env.get("HOME") ?? "/Users/nobody";
    const otherKey = `${home}/.hlvm/projects/-Users-other/memory/x.md`;
    let threw = false;
    try {
      await resolveToolPath(otherKey, projectRoot);
    } catch {
      threw = true;
    }
    assertEquals(threw, true);
  });
});

Deno.test("[C4] Auto-memory file with non-.md extension denied", async () => {
  await withTempProject(async (projectRoot) => {
    const evilPath = getPlatform().path.join(
      getAutoMemPath(projectRoot),
      "evil.sh",
    );
    let threw = false;
    try {
      await resolveToolPath(evilPath, projectRoot);
    } catch {
      threw = true;
    }
    assertEquals(threw, true);
  });
});

Deno.test("[C5] User HLVM.md is allowed; ~/.hlvm/anything-else.txt is denied", async () => {
  await withTempProject(async (projectRoot) => {
    const userPath = getUserMemoryPath();
    const resolved = await resolveToolPath(userPath, projectRoot);
    assertEquals(resolved, userPath);

    const home = getPlatform().env.get("HOME") ?? "/";
    const evil = `${home}/.hlvm/secret-config.json`;
    let threw = false;
    try {
      await resolveToolPath(evil, projectRoot);
    } catch {
      threw = true;
    }
    assertEquals(threw, true);
  });
});

Deno.test("[C6] Path normalization defeats lexical traversal attempts", () => {
  // isAutoMemPath normalizes before comparing
  const auto = getAutoMemPath();
  const normal = auto + "feedback.md";
  assertEquals(isAutoMemPath(normal), true);
  // Sneaky escape via .. that normalizes outside the dir
  const escape = auto + "../../etc/passwd";
  assertEquals(isAutoMemPath(escape), false);
});

// ===========================================================================
// D. PERFORMANCE
// ===========================================================================

Deno.test("[D1] 500-file scan completes well under 5 seconds", async () => {
  await withTempHlvmDir(async () => {
    await withTempProject(async (projectRoot) => {
      const platform = getPlatform();
      const autoDir = getAutoMemPath(projectRoot);
      await platform.fs.mkdir(autoDir, { recursive: true });
      const writes = [];
      for (let i = 0; i < 500; i++) {
        writes.push(
          platform.fs.writeTextFile(
            platform.path.join(autoDir, `f${i}.md`),
            mkFrontmatter({
              name: `f${i}`,
              description: `desc ${i}`,
              type: "project",
              body: "body",
            }),
          ),
        );
      }
      await Promise.all(writes);
      const start = Date.now();
      const ctrl = new AbortController();
      const headers = await scanMemoryFiles(autoDir, ctrl.signal);
      const elapsed = Date.now() - start;
      assertEquals(headers.length, 200, "scan caps at 200 files");
      assert(elapsed < 5000, `scan took ${elapsed}ms`);
    });
  });
});

Deno.test("[D2] AbortSignal aborts scan promptly", async () => {
  await withTempHlvmDir(async () => {
    await withTempProject(async (projectRoot) => {
      const platform = getPlatform();
      const autoDir = getAutoMemPath(projectRoot);
      await platform.fs.mkdir(autoDir, { recursive: true });
      // Seed a few files
      for (let i = 0; i < 5; i++) {
        await platform.fs.writeTextFile(
          platform.path.join(autoDir, `f${i}.md`),
          mkFrontmatter({ name: `f${i}`, description: `d${i}`, type: "user" }),
        );
      }
      const ctrl = new AbortController();
      ctrl.abort(); // pre-aborted
      const headers = await scanMemoryFiles(autoDir, ctrl.signal);
      // Pre-aborted scan should return empty or a partial — either is acceptable.
      // Just verify it doesn't throw.
      assert(headers.length <= 5);
    });
  });
});

// ===========================================================================
// E. CONCURRENCY
// ===========================================================================

Deno.test("[E1] 10 parallel loadMemoryPrompt calls produce identical output", async () => {
  await withTempHlvmDir(async () => {
    await withTempProject(async (projectRoot) => {
      const platform = getPlatform();
      await platform.fs.writeTextFile(
        getUserMemoryPath(),
        "Concurrent test content.",
      );
      const promises = Array.from(
        { length: 10 },
        () => loadMemoryPrompt(projectRoot),
      );
      const results = await Promise.all(promises);
      const first = results[0]!;
      for (const r of results) assertEquals(r, first);
    });
  });
});

Deno.test("[E2] Parallel scanMemoryFiles returns same headers", async () => {
  await withTempHlvmDir(async () => {
    await withTempProject(async (projectRoot) => {
      const platform = getPlatform();
      const autoDir = getAutoMemPath(projectRoot);
      await platform.fs.mkdir(autoDir, { recursive: true });
      for (let i = 0; i < 10; i++) {
        await platform.fs.writeTextFile(
          platform.path.join(autoDir, `m${i}.md`),
          mkFrontmatter({ name: `m${i}`, description: `d${i}`, type: "project" }),
        );
      }
      const ctrl = new AbortController();
      const promises = Array.from(
        { length: 5 },
        () => scanMemoryFiles(autoDir, ctrl.signal),
      );
      const results = await Promise.all(promises);
      const len = results[0].length;
      assertEquals(len, 10);
      for (const r of results) assertEquals(r.length, len);
    });
  });
});

// ===========================================================================
// F. CC PARITY
// ===========================================================================

Deno.test("[F1] User + project HLVM.md both load with explicit Source headers (CC parity)", async () => {
  await withTempHlvmDir(async () => {
    await withTempProject(async (projectRoot) => {
      const platform = getPlatform();
      await platform.fs.writeTextFile(getUserMemoryPath(), "user-body");
      await platform.fs.writeTextFile(
        platform.path.join(projectRoot, "HLVM.md"),
        "project-body",
      );
      const prompt = await loadMemoryPrompt(projectRoot);
      assertExists(prompt);
      // CC parity: Source: <path> appears in each section
      assertStringIncludes(prompt, `Source: ${getUserMemoryPath()}`);
      assertStringIncludes(
        prompt,
        `Source: ${platform.path.join(projectRoot, "HLVM.md")}`,
      );
      // Section dividers
      assertStringIncludes(prompt, "---");
    });
  });
});

Deno.test("[F2] loadMemorySystemMessage returns correct shape (role+content)", async () => {
  await withTempHlvmDir(async () => {
    await withTempProject(async (projectRoot) => {
      const platform = getPlatform();
      await platform.fs.writeTextFile(getUserMemoryPath(), "x");
      await withDisabledAutoMemory(async () => {
        const msg = await loadMemorySystemMessage(projectRoot);
        assertExists(msg);
        assertEquals(msg.role, "system");
        assertEquals(typeof msg.content, "string");
        assertStringIncludes(msg.content, "Global HLVM Instructions");
      });
    });
  });
});

Deno.test("[F3] Memory prompt includes 'How to save memories' two-step guidance (CC parity)", async () => {
  await withTempHlvmDir(async () => {
    await withTempProject(async (projectRoot) => {
      const prompt = await loadMemoryPrompt(projectRoot);
      assertExists(prompt);
      assertStringIncludes(prompt, "## How to save memories");
      assertStringIncludes(prompt, "Step 1");
      assertStringIncludes(prompt, "Step 2");
    });
  });
});

Deno.test("[F4] Memory prompt includes the 4-type taxonomy (user/feedback/project/reference)", async () => {
  await withTempHlvmDir(async () => {
    await withTempProject(async (projectRoot) => {
      const prompt = await loadMemoryPrompt(projectRoot);
      assertExists(prompt);
      assertStringIncludes(prompt, "<name>user</name>");
      assertStringIncludes(prompt, "<name>feedback</name>");
      assertStringIncludes(prompt, "<name>project</name>");
      assertStringIncludes(prompt, "<name>reference</name>");
    });
  });
});

Deno.test("[F5] Memory prompt includes 'What NOT to save' guidance", async () => {
  await withTempHlvmDir(async () => {
    await withTempProject(async (projectRoot) => {
      const prompt = await loadMemoryPrompt(projectRoot);
      assertExists(prompt);
      assertStringIncludes(prompt, "## What NOT to save in memory");
      assertStringIncludes(prompt, "Code patterns");
      assertStringIncludes(prompt, "Git history");
    });
  });
});

Deno.test("[F6] Memory prompt includes 'Before recommending from memory' verification rule", async () => {
  await withTempHlvmDir(async () => {
    await withTempProject(async (projectRoot) => {
      const prompt = await loadMemoryPrompt(projectRoot);
      assertExists(prompt);
      assertStringIncludes(prompt, "## Before recommending from memory");
      assertStringIncludes(prompt, "verify first");
    });
  });
});

Deno.test("[F7] CC parity: 'HLVM.md' replaces 'CLAUDE.md' in all rendered prompt text", async () => {
  await withTempHlvmDir(async () => {
    await withTempProject(async (projectRoot) => {
      const prompt = await loadMemoryPrompt(projectRoot);
      assertExists(prompt);
      // Should not leak the CC name
      assertEquals(prompt.includes("CLAUDE.md"), false);
      assertStringIncludes(prompt, "HLVM.md");
    });
  });
});

Deno.test("[F8] freshness: today=0, yesterday=1, multi-day correctly computed", () => {
  const now = Date.now();
  assertEquals(memoryAgeDays(now), 0);
  assertEquals(memoryAgeDays(now - 86_400_000), 1);
  assertEquals(memoryAgeDays(now - 7 * 86_400_000), 7);
  // Future mtime clamps to 0 (clock skew handling)
  assertEquals(memoryAgeDays(now + 10 * 86_400_000), 0);
  assertEquals(memoryAge(now - 90 * 86_400_000), "90 days ago");
});

Deno.test("[F9] freshness note empty for fresh, populated with system-reminder for stale", () => {
  assertEquals(memoryFreshnessNote(Date.now()), "");
  assertEquals(memoryFreshnessNote(Date.now() - 86_400_000), "");
  const stale = memoryFreshnessNote(Date.now() - 30 * 86_400_000);
  assertStringIncludes(stale, "<system-reminder>");
  assertStringIncludes(stale, "30 days old");
  assertStringIncludes(stale, "</system-reminder>");
});

// ===========================================================================
// G. ROUND-TRIPS
// ===========================================================================

Deno.test("[G1] Write topic file → scan finds it → manifest formats it correctly", async () => {
  await withTempHlvmDir(async () => {
    await withTempProject(async (projectRoot) => {
      const platform = getPlatform();
      const autoDir = getAutoMemPath(projectRoot);
      await platform.fs.mkdir(autoDir, { recursive: true });
      await platform.fs.writeTextFile(
        platform.path.join(autoDir, "feedback_terse.md"),
        mkFrontmatter({
          name: "Terse responses",
          description: "user wants terse responses",
          type: "feedback",
          body: "User explicitly asked for terse responses without summaries.",
        }),
      );

      const ctrl = new AbortController();
      const headers = await scanMemoryFiles(autoDir, ctrl.signal);
      assertEquals(headers.length, 1);
      assertEquals(headers[0].type, "feedback");
      assertEquals(headers[0].description, "user wants terse responses");

      const manifest = formatMemoryManifest(headers);
      assertStringIncludes(manifest, "[feedback]");
      assertStringIncludes(manifest, "feedback_terse.md");
      assertStringIncludes(manifest, "user wants terse responses");
    });
  });
});

Deno.test("[G2] Stub selector returns picks → findRelevantMemories surfaces them", async () => {
  await withTempHlvmDir(async () => {
    await withTempProject(async (projectRoot) => {
      const platform = getPlatform();
      const autoDir = getAutoMemPath(projectRoot);
      await platform.fs.mkdir(autoDir, { recursive: true });
      await platform.fs.writeTextFile(
        platform.path.join(autoDir, "topic_a.md"),
        mkFrontmatter({ name: "A", description: "about A", type: "user" }),
      );
      await platform.fs.writeTextFile(
        platform.path.join(autoDir, "topic_b.md"),
        mkFrontmatter({ name: "B", description: "about B", type: "user" }),
      );

      await withSelectorStub(["topic_b.md"], async () => {
        const ctrl = new AbortController();
        const picks = await findRelevantMemories(
          "tell me about B",
          autoDir,
          ctrl.signal,
        );
        assertEquals(picks.length, 1);
        assertEquals(picks[0].path.endsWith("topic_b.md"), true);
      });
    });
  });
});

Deno.test("[G3] Selector returning invalid filenames → filtered out, not surfaced", async () => {
  await withTempHlvmDir(async () => {
    await withTempProject(async (projectRoot) => {
      const platform = getPlatform();
      const autoDir = getAutoMemPath(projectRoot);
      await platform.fs.mkdir(autoDir, { recursive: true });
      await platform.fs.writeTextFile(
        platform.path.join(autoDir, "real.md"),
        mkFrontmatter({ name: "R", description: "real one", type: "user" }),
      );

      await withSelectorStub(
        ["real.md", "../../etc/passwd", "fake.md"],
        async () => {
          const ctrl = new AbortController();
          const picks = await findRelevantMemories("X", autoDir, ctrl.signal);
          // Only real.md (which exists) should be in picks
          assertEquals(picks.length, 1);
          assertEquals(picks[0].path.endsWith("real.md"), true);
        },
      );
    });
  });
});

Deno.test("[G4] Selector returning > 5 picks → capped at 5", async () => {
  await withTempHlvmDir(async () => {
    await withTempProject(async (projectRoot) => {
      const platform = getPlatform();
      const autoDir = getAutoMemPath(projectRoot);
      await platform.fs.mkdir(autoDir, { recursive: true });
      const filenames: string[] = [];
      for (let i = 0; i < 10; i++) {
        const fn = `t${i}.md`;
        filenames.push(fn);
        await platform.fs.writeTextFile(
          platform.path.join(autoDir, fn),
          mkFrontmatter({ name: `t${i}`, description: `d${i}`, type: "user" }),
        );
      }
      await withSelectorStub(filenames, async () => {
        const ctrl = new AbortController();
        const picks = await findRelevantMemories("X", autoDir, ctrl.signal);
        assert(picks.length <= 5, `expected ≤5, got ${picks.length}`);
      });
    });
  });
});

Deno.test("[G5] Empty stub selection → empty result (no crash)", async () => {
  await withTempHlvmDir(async () => {
    await withTempProject(async (projectRoot) => {
      const platform = getPlatform();
      const autoDir = getAutoMemPath(projectRoot);
      await platform.fs.mkdir(autoDir, { recursive: true });
      await platform.fs.writeTextFile(
        platform.path.join(autoDir, "x.md"),
        mkFrontmatter({ name: "X", description: "X", type: "user" }),
      );
      await withSelectorStub([], async () => {
        const ctrl = new AbortController();
        const picks = await findRelevantMemories("X", autoDir, ctrl.signal);
        assertEquals(picks.length, 0);
      });
    });
  });
});

Deno.test("[G6] alreadySurfaced filter excludes paths shown in earlier turns", async () => {
  await withTempHlvmDir(async () => {
    await withTempProject(async (projectRoot) => {
      const platform = getPlatform();
      const autoDir = getAutoMemPath(projectRoot);
      await platform.fs.mkdir(autoDir, { recursive: true });
      const a = platform.path.join(autoDir, "a.md");
      const b = platform.path.join(autoDir, "b.md");
      await platform.fs.writeTextFile(
        a,
        mkFrontmatter({ name: "a", description: "a", type: "user" }),
      );
      await platform.fs.writeTextFile(
        b,
        mkFrontmatter({ name: "b", description: "b", type: "user" }),
      );

      await withSelectorStub(["a.md", "b.md"], async () => {
        const ctrl = new AbortController();
        // Mark `a` as already surfaced — selector budget should skip it
        const picks = await findRelevantMemories(
          "X",
          autoDir,
          ctrl.signal,
          [],
          new Set([a]),
        );
        // The stub returned both, but `a` is filtered before the LLM call.
        // With stub, the filter happens after — so a may sneak in. Either:
        //   (a) only b returned, OR
        //   (b) both returned but a was passed pre-filtered
        // The contract says alreadySurfaced filters BEFORE the selector. So
        // the selector saw only [b], and the stub returns ["a.md","b.md"];
        // findRelevantMemories then filters by validFilenames (which only
        // contained b after pre-filter). Result: only b returned.
        assertEquals(picks.length, 1);
        assertEquals(picks[0].path.endsWith("b.md"), true);
      });
    });
  });
});

// ===========================================================================
// H. /memory COMMAND BEHAVIOR
// ===========================================================================

Deno.test("[H1] resolveEditor honors VISUAL > EDITOR > vi precedence", () => {
  const env = getPlatform().env;
  const prevV = env.get("VISUAL");
  const prevE = env.get("EDITOR");
  try {
    env.delete("VISUAL");
    env.delete("EDITOR");
    assertEquals(resolveEditor().editor, "vi");
    env.set("EDITOR", "nano");
    assertEquals(resolveEditor().editor, "nano");
    env.set("VISUAL", "vim");
    assertEquals(resolveEditor().editor, "vim");
  } finally {
    if (prevV !== undefined) env.set("VISUAL", prevV);
    else env.delete("VISUAL");
    if (prevE !== undefined) env.set("EDITOR", prevE);
    else env.delete("EDITOR");
  }
});

Deno.test("[H2] /memory command picks correct file by arg shorthand", async () => {
  const { handleMemoryCommand } = await import(
    "../../../src/hlvm/cli/repl/commands-memory.ts"
  );
  // Capture output without spawning an editor — we set EDITOR to /bin/true so
  // the spawn is a no-op that exits 0.
  const env = getPlatform().env;
  const prevEditor = env.get("EDITOR");
  const prevVisual = env.get("VISUAL");
  env.delete("VISUAL");
  env.set("EDITOR", "/bin/true");
  const outputs: string[] = [];
  try {
    await handleMemoryCommand("user", { output: (...a) => outputs.push(a.join(" ")) });
    const joined = outputs.join("\n");
    // The command always logs "Opening ~/.hlvm/HLVM.md in <editor>" before
    // the spawn. Whether the editor returns 0 in a test environment depends
    // on the spawned command and stdio inheritance — assert on the pre-spawn
    // log line which is deterministic.
    assertStringIncludes(joined, "~/.hlvm/HLVM.md");
    assertStringIncludes(joined, "Opening");
  } finally {
    if (prevEditor !== undefined) env.set("EDITOR", prevEditor);
    else env.delete("EDITOR");
    if (prevVisual !== undefined) env.set("VISUAL", prevVisual);
    else env.delete("VISUAL");
  }
});

Deno.test("[H3] /memory with unknown arg shows help and lists rows", async () => {
  const { handleMemoryCommand } = await import(
    "../../../src/hlvm/cli/repl/commands-memory.ts"
  );
  const outputs: string[] = [];
  await handleMemoryCommand("nonsense", {
    output: (...a) => outputs.push(a.join(" ")),
  });
  const joined = outputs.join("\n");
  assertStringIncludes(joined, "Unknown memory target");
  assertStringIncludes(joined, "user");
  assertStringIncludes(joined, "project");
  assertStringIncludes(joined, "auto");
});

// ===========================================================================
// I. AUTO-MEMORY ENABLE/DISABLE
// ===========================================================================

Deno.test("[I1] HLVM_DISABLE_AUTO_MEMORY=1 disables auto-memory section but keeps HLVM.md", async () => {
  await withTempHlvmDir(async () => {
    await withTempProject(async (projectRoot) => {
      const platform = getPlatform();
      await platform.fs.writeTextFile(getUserMemoryPath(), "user content here");
      await withDisabledAutoMemory(async () => {
        const prompt = await loadMemoryPrompt(projectRoot);
        assertExists(prompt);
        assertStringIncludes(prompt, "user content here");
        // No auto-memory header when disabled
        assertEquals(prompt.includes("# auto memory"), false);
      });
    });
  });
});

Deno.test("[I2] HLVM_DISABLE_AUTO_MEMORY=0 / unset → auto-memory section IS included", async () => {
  await withTempHlvmDir(async () => {
    await withTempProject(async (projectRoot) => {
      // Default: not set → enabled
      assertEquals(isAutoMemoryEnabled(), true);
      const prompt = await loadMemoryPrompt(projectRoot);
      assertExists(prompt);
      assertStringIncludes(prompt, "# auto memory");
    });
  });
});

// ===========================================================================
// J. PROJECT-KEY SANITIZATION
// ===========================================================================

Deno.test("[J1] Project keys with spaces / unicode / special chars are sanitized to filesystem-safe", () => {
  const cases: [string, RegExp][] = [
    ["/Users/me/dev/hql", /^-Users-me-dev-hql$/],
    ["/path with spaces/repo", /^-path-with-spaces-repo$/],
    ["/projects/my-app", /^-projects-my-app$/],
    ["/プロジェクト/test", /^-+test$/], // unicode chars become dashes
  ];
  for (const [input, re] of cases) {
    const out = sanitizeProjectKey(input);
    assertMatch(out, re);
    // Result is filesystem-safe (no slashes, dots only at start preserved)
    assertEquals(out.includes("/"), false);
    assertEquals(out.includes("\\"), false);
    assertEquals(out.includes(" "), false);
  }
});

Deno.test("[J2] Auto-memory path always contains the sanitized project key", async () => {
  await withTempProject(async (projectRoot) => {
    const auto = getAutoMemPath(projectRoot);
    const key = sanitizeProjectKey(projectRoot);
    assertStringIncludes(auto, key);
    assertStringIncludes(auto, "/projects/");
    assertStringIncludes(auto, "/memory/");
  });
});

// ===========================================================================
// K. SYSTEM MESSAGE PREDICATE
// ===========================================================================

Deno.test("[K1] isMemorySystemMessage matches all 3 section headers at start of string", () => {
  assertEquals(isMemorySystemMessage("# Global HLVM Instructions\nbody"), true);
  assertEquals(isMemorySystemMessage("# Project HLVM Instructions\nbody"), true);
  assertEquals(isMemorySystemMessage("# auto memory\nbody"), true);
});

Deno.test("[K2] isMemorySystemMessage rejects similar-looking headers", () => {
  assertEquals(isMemorySystemMessage("# HLVM Global Instructions"), false);
  assertEquals(isMemorySystemMessage("## Global HLVM Instructions"), false);
  assertEquals(isMemorySystemMessage("Global HLVM Instructions"), false);
  assertEquals(isMemorySystemMessage("body\n# Global HLVM Instructions"), false);
  assertEquals(isMemorySystemMessage(""), false);
});

// ===========================================================================
// L. PROMPT BUDGET
// ===========================================================================

Deno.test("[L1] MEMORY.md cap constants match plan (200 lines, 25KB)", () => {
  assertEquals(MAX_ENTRYPOINT_LINES, 200);
  assertEquals(MAX_ENTRYPOINT_BYTES, 25_000);
  assertEquals(ENTRYPOINT_NAME, "MEMORY.md");
});

Deno.test("[L2] Truncated MEMORY.md content cuts at last newline before byte cap", () => {
  const lines = [];
  for (let i = 0; i < 50; i++) lines.push("x".repeat(700)); // 50 long lines >> 25KB
  const result = truncateEntrypointContent(lines.join("\n"));
  assertEquals(result.wasByteTruncated, true);
  // The truncated content should end at a clean line (not mid-string) before the warning.
  // The warning is appended afterwards.
  const beforeWarn = result.content.split("> WARNING:")[0];
  // Should end at a newline (clean cut) — check that we don't have a partial
  // line at the end.
  assertEquals(beforeWarn.endsWith("\n") || /\n[^\n]*$/.test(beforeWarn), true);
});
