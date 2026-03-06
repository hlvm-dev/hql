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

const createIgnore: () => Ignore = ignoreModule.default;

Deno.test("file utils: isIgnored respects wildcard file patterns across nested paths", () => {
  const ig = createIgnore();
  ig.add("*.log");

  assertEquals(isIgnored("app.log", ig), true);
  assertEquals(isIgnored("dir/app.log", ig), true);
  assertEquals(isIgnored("deep/nested/app.log", ig), true);
  assertEquals(isIgnored("app.txt", ig), false);
});

Deno.test("file utils: isIgnored handles directory rules and negation correctly", () => {
  const directories = createIgnore();
  directories.add("logs/\ndist");

  assertEquals(isIgnored("logs", directories), false);
  assertEquals(isIgnored("logs/", directories), true);
  assertEquals(isIgnored("logs/app.log", directories), true);
  assertEquals(isIgnored("dist", directories), true);
  assertEquals(isIgnored("dist/bundle.js", directories), true);

  const reinclude = createIgnore();
  reinclude.add("build/*\n!build/output.js");

  assertEquals(isIgnored("build/temp.js", reinclude), true);
  assertEquals(isIgnored("build/output.js", reinclude), false);
});

Deno.test("file utils: isIgnored ignores comments and blank lines and empty instances match nothing", () => {
  const ig = createIgnore();
  ig.add("# comment\n\n*.tmp\n  \n*.pyc");

  assertEquals(isIgnored("data.tmp", ig), true);
  assertEquals(isIgnored("src/test.pyc", ig), true);
  assertEquals(isIgnored("src/index.ts", ig), false);
  assertEquals(isIgnored("anything.txt", createIgnore()), false);
});

Deno.test("file utils: shouldSkipFile filters only known lock and generated file patterns", () => {
  assertEquals(shouldSkipFile("package-lock.json"), true);
  assertEquals(shouldSkipFile("bundle.min.js"), true);
  assertEquals(shouldSkipFile("main.js.map"), true);
  assertEquals(shouldSkipFile("types.d.ts"), true);
  assertEquals(shouldSkipFile("index.ts"), false);
  assertEquals(shouldSkipFile("README.md"), false);
});

Deno.test("file utils: exported skip sets retain representative defaults", () => {
  assertEquals(SKIP_DIRS.has("node_modules"), true);
  assertEquals(SKIP_DIRS.has(".git"), true);
  assertEquals(SKIP_EXTENSIONS.has(".map"), true);
  assertEquals(SKIP_EXTENSIONS.has(".lock"), true);
  assertEquals(SKIP_EXACT_NAMES.has("package-lock.json"), true);
  assertEquals(SKIP_EXACT_NAMES.has("yarn.lock"), true);
});
