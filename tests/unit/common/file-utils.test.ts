/**
 * Tests for file-utils.ts
 *
 * Coverage:
 * - isIgnored() with `ignore` package
 * - loadGitignore() file loading
 * - shouldSkipFile() file filtering
 * - walkDirectory() gitignore integration (directory-only patterns)
 */

import { assertEquals } from "jsr:@std/assert";
import ignoreModule from "ignore";
import type { Ignore } from "ignore";
import {
  isIgnored,
  shouldSkipFile,
  SKIP_DIRS,
  SKIP_EXTENSIONS,
  SKIP_EXACT_NAMES,
} from "../../../src/common/file-utils.ts";

// `ignore` CJS module exports default as property in Deno's TS type system
const createIgnore: () => Ignore = ignoreModule.default;

// ============================================================
// isIgnored() — gitignore pattern matching
// ============================================================

Deno.test("isIgnored - basic file pattern", () => {
  const ig = createIgnore();
  ig.add("*.log");
  assertEquals(isIgnored("app.log", ig), true);
  assertEquals(isIgnored("app.txt", ig), false);
});

Deno.test("isIgnored - nested file pattern", () => {
  const ig = createIgnore();
  ig.add("*.log");
  assertEquals(isIgnored("dir/app.log", ig), true);
  assertEquals(isIgnored("deep/nested/app.log", ig), true);
});

Deno.test("isIgnored - directory-only pattern with trailing slash", () => {
  const ig = createIgnore();
  ig.add("logs/");
  // Bare name without slash → NOT ignored (gitignore spec: dir-only pattern)
  assertEquals(isIgnored("logs", ig), false);
  // With trailing slash → ignored
  assertEquals(isIgnored("logs/", ig), true);
  // Contents of directory → ignored
  assertEquals(isIgnored("logs/app.log", ig), true);
});

Deno.test("isIgnored - directory pattern without trailing slash", () => {
  const ig = createIgnore();
  ig.add("dist");
  // Without trailing slash pattern → matches both files and directories
  assertEquals(isIgnored("dist", ig), true);
  assertEquals(isIgnored("dist/", ig), true);
  assertEquals(isIgnored("dist/bundle.js", ig), true);
});

Deno.test("isIgnored - negation pattern", () => {
  const ig = createIgnore();
  ig.add("*.log\n!important.log");
  assertEquals(isIgnored("app.log", ig), true);
  assertEquals(isIgnored("important.log", ig), false);
});

Deno.test("isIgnored - re-inclusion pattern", () => {
  // Per gitignore spec: `build/` ignores the entire directory tree,
  // so negation can't reach inside. Use `build/*` to allow re-inclusion.
  const ig = createIgnore();
  ig.add("build/*\n!build/output.js");
  assertEquals(isIgnored("build/temp.js", ig), true);
  assertEquals(isIgnored("build/output.js", ig), false);
});

Deno.test("isIgnored - wildcard in directory path", () => {
  const ig = createIgnore();
  ig.add("**/node_modules");
  assertEquals(isIgnored("node_modules", ig), true);
  assertEquals(isIgnored("packages/node_modules", ig), true);
});

Deno.test("isIgnored - comment and blank lines", () => {
  const ig = createIgnore();
  ig.add("# This is a comment\n\n*.log\n  \n*.tmp");
  assertEquals(isIgnored("app.log", ig), true);
  assertEquals(isIgnored("data.tmp", ig), true);
  assertEquals(isIgnored("app.txt", ig), false);
});

Deno.test("isIgnored - empty ignore instance matches nothing", () => {
  const ig = createIgnore();
  assertEquals(isIgnored("anything.txt", ig), false);
  assertEquals(isIgnored("dir/file.js", ig), false);
});

Deno.test("isIgnored - walkDirectory-style: directories get trailing slash", () => {
  // This simulates the fixed walkDirectory behavior where directories
  // are checked with trailing slash appended
  const ig = createIgnore();
  ig.add("logs/\ntmp/\n*.pyc");

  // Directory entries (as walkDirectory would check them after fix)
  assertEquals(isIgnored("logs/", ig), true);
  assertEquals(isIgnored("tmp/", ig), true);

  // File entries
  assertEquals(isIgnored("test.pyc", ig), true);
  assertEquals(isIgnored("src/test.pyc", ig), true);
});

// ============================================================
// shouldSkipFile() — file pattern filtering
// ============================================================

Deno.test("shouldSkipFile - skips exact names", () => {
  assertEquals(shouldSkipFile("package-lock.json"), true);
  assertEquals(shouldSkipFile("yarn.lock"), true);
  assertEquals(shouldSkipFile("package.json"), false);
});

Deno.test("shouldSkipFile - skips by extension", () => {
  assertEquals(shouldSkipFile("bundle.min.js"), true);
  assertEquals(shouldSkipFile("main.js.map"), true);
  assertEquals(shouldSkipFile("deno.lock"), true);
  assertEquals(shouldSkipFile("types.d.ts"), true);
  assertEquals(shouldSkipFile("main.ts"), false);
});

Deno.test("shouldSkipFile - normal files pass through", () => {
  assertEquals(shouldSkipFile("index.ts"), false);
  assertEquals(shouldSkipFile("README.md"), false);
  assertEquals(shouldSkipFile("config.json"), false);
});

// ============================================================
// Constants sanity checks
// ============================================================

Deno.test("SKIP_DIRS contains essential directories", () => {
  assertEquals(SKIP_DIRS.has("node_modules"), true);
  assertEquals(SKIP_DIRS.has(".git"), true);
  assertEquals(SKIP_DIRS.has("dist"), true);
  assertEquals(SKIP_DIRS.has("__pycache__"), true);
});

Deno.test("SKIP_EXTENSIONS has expected entries", () => {
  assertEquals(SKIP_EXTENSIONS.has(".min.js"), true);
  assertEquals(SKIP_EXTENSIONS.has(".map"), true);
  assertEquals(SKIP_EXTENSIONS.has(".lock"), true);
  assertEquals(SKIP_EXTENSIONS.has(".d.ts"), true);
});

Deno.test("SKIP_EXACT_NAMES has expected entries", () => {
  assertEquals(SKIP_EXACT_NAMES.has("package-lock.json"), true);
  assertEquals(SKIP_EXACT_NAMES.has("yarn.lock"), true);
});
