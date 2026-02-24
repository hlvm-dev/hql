/**
 * Integration tests for file-utils.ts
 *
 * Tests walkDirectory() with real filesystem + gitignore files.
 * Validates the full pipeline: loadGitignore → isIgnored → walkDirectory.
 */

import { assertEquals } from "jsr:@std/assert";
import {
  walkDirectory,
  loadGitignore,
  isIgnored,
} from "../../../src/common/file-utils.ts";
import { getPlatform } from "../../../src/platform/platform.ts";

/** Create a temp directory structure for testing */
async function createTempTree(
  structure: Record<string, string | null>,
): Promise<string> {
  const platform = getPlatform();
  const tmpDir = await Deno.makeTempDir({ prefix: "file-utils-test-" });

  for (const [path, content] of Object.entries(structure)) {
    const fullPath = platform.path.join(tmpDir, path);
    const dir = platform.path.dirname(fullPath);
    await Deno.mkdir(dir, { recursive: true });
    if (content !== null) {
      await Deno.writeTextFile(fullPath, content);
    }
    // null means directory-only (already created by mkdir)
  }

  return tmpDir;
}

/** Collect all paths from walkDirectory */
async function collectPaths(
  options: Parameters<typeof walkDirectory>[0],
): Promise<string[]> {
  const paths: string[] = [];
  for await (const entry of walkDirectory(options)) {
    paths.push(entry.path);
  }
  return paths.sort();
}

// ============================================================
// walkDirectory + gitignore integration
// ============================================================

Deno.test("walkDirectory - respects gitignore file patterns", async () => {
  const tmpDir = await createTempTree({
    ".gitignore": "*.log\n*.tmp\n",
    "src/main.ts": "export {}",
    "src/debug.log": "debug output",
    "data.tmp": "temp data",
    "readme.md": "# Hello",
  });

  try {
    const ig = await loadGitignore(tmpDir);
    const paths = await collectPaths({
      baseDir: tmpDir,
      gitignorePatterns: ig,
    });

    // Should include: src/, src/main.ts, readme.md
    assertEquals(paths.includes("src"), true, "src directory should be included");
    assertEquals(paths.includes("src/main.ts"), true, "main.ts should be included");
    assertEquals(paths.includes("readme.md"), true, "readme.md should be included");

    // Should exclude: debug.log, data.tmp (gitignored)
    assertEquals(paths.includes("src/debug.log"), false, "debug.log should be gitignored");
    assertEquals(paths.includes("data.tmp"), false, "data.tmp should be gitignored");
  } finally {
    await Deno.remove(tmpDir, { recursive: true });
  }
});

Deno.test("walkDirectory - directory-only gitignore patterns with trailing slash", async () => {
  const tmpDir = await createTempTree({
    ".gitignore": "logs/\ntmp/\n",
    "src/main.ts": "export {}",
    "logs/app.log": "log data",
    "logs/error.log": "error data",
    "tmp/cache.json": "cache",
    "readme.md": "# Hello",
  });

  try {
    const ig = await loadGitignore(tmpDir);
    const paths = await collectPaths({
      baseDir: tmpDir,
      gitignorePatterns: ig,
    });

    // Should include: src/, src/main.ts, readme.md
    assertEquals(paths.includes("src"), true, "src directory should be included");
    assertEquals(paths.includes("src/main.ts"), true, "main.ts should be included");
    assertEquals(paths.includes("readme.md"), true, "readme.md should be included");

    // Should exclude: logs/ and tmp/ directories and their contents
    assertEquals(paths.includes("logs"), false, "logs dir should be gitignored");
    assertEquals(paths.includes("logs/app.log"), false, "logs/app.log should be gitignored");
    assertEquals(paths.includes("logs/error.log"), false, "logs/error.log should be gitignored");
    assertEquals(paths.includes("tmp"), false, "tmp dir should be gitignored");
    assertEquals(paths.includes("tmp/cache.json"), false, "tmp/cache.json should be gitignored");
  } finally {
    await Deno.remove(tmpDir, { recursive: true });
  }
});

Deno.test("walkDirectory - negation patterns work", async () => {
  const tmpDir = await createTempTree({
    ".gitignore": "*.log\n!important.log\n",
    "app.log": "app log",
    "important.log": "keep this",
    "readme.md": "# Hello",
  });

  try {
    const ig = await loadGitignore(tmpDir);
    const paths = await collectPaths({
      baseDir: tmpDir,
      gitignorePatterns: ig,
    });

    // app.log should be ignored, important.log should be kept (negation)
    assertEquals(paths.includes("app.log"), false, "app.log should be gitignored");
    assertEquals(paths.includes("important.log"), true, "important.log should be kept (negation)");
    assertEquals(paths.includes("readme.md"), true, "readme.md should be included");
  } finally {
    await Deno.remove(tmpDir, { recursive: true });
  }
});

Deno.test("walkDirectory - no gitignore returns all files", async () => {
  const tmpDir = await createTempTree({
    "src/main.ts": "export {}",
    "readme.md": "# Hello",
    "data.json": "{}",
  });

  try {
    // loadGitignore with no .gitignore returns empty Ignore instance
    const ig = await loadGitignore(tmpDir);
    const paths = await collectPaths({
      baseDir: tmpDir,
      gitignorePatterns: ig,
    });

    assertEquals(paths.includes("src"), true);
    assertEquals(paths.includes("src/main.ts"), true);
    assertEquals(paths.includes("readme.md"), true);
    assertEquals(paths.includes("data.json"), true);
  } finally {
    await Deno.remove(tmpDir, { recursive: true });
  }
});

Deno.test("walkDirectory - SKIP_DIRS still works alongside gitignore", async () => {
  const tmpDir = await createTempTree({
    ".gitignore": "*.tmp\n",
    "src/main.ts": "export {}",
    "node_modules/dep/index.js": "module.exports = {}",
    "temp.tmp": "temp",
  });

  try {
    const ig = await loadGitignore(tmpDir);
    const paths = await collectPaths({
      baseDir: tmpDir,
      gitignorePatterns: ig,
    });

    // src should be included
    assertEquals(paths.includes("src"), true);
    assertEquals(paths.includes("src/main.ts"), true);

    // node_modules should be skipped by SKIP_DIRS
    assertEquals(paths.includes("node_modules"), false, "node_modules should be skipped by SKIP_DIRS");

    // *.tmp should be skipped by gitignore
    assertEquals(paths.includes("temp.tmp"), false, "temp.tmp should be gitignored");
  } finally {
    await Deno.remove(tmpDir, { recursive: true });
  }
});

// ============================================================
// loadGitignore edge cases
// ============================================================

Deno.test("loadGitignore - missing gitignore returns empty Ignore", async () => {
  const tmpDir = await Deno.makeTempDir({ prefix: "file-utils-test-" });
  try {
    const ig = await loadGitignore(tmpDir);
    // Empty Ignore instance ignores nothing
    assertEquals(isIgnored("anything.txt", ig), false);
    assertEquals(isIgnored("dir/file.js", ig), false);
  } finally {
    await Deno.remove(tmpDir, { recursive: true });
  }
});

Deno.test("loadGitignore - handles comments and blank lines", async () => {
  const tmpDir = await createTempTree({
    ".gitignore": "# Build output\n\ndist/\n\n# Logs\n*.log\n",
  });

  try {
    const ig = await loadGitignore(tmpDir);
    assertEquals(isIgnored("dist/", ig), true);
    assertEquals(isIgnored("app.log", ig), true);
    assertEquals(isIgnored("src/main.ts", ig), false);
  } finally {
    await Deno.remove(tmpDir, { recursive: true });
  }
});
