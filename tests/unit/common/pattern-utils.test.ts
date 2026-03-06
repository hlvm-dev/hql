import { assertEquals, assertThrows } from "jsr:@std/assert";
import {
  filterByGlob,
  globToRegex,
  GlobPatternError,
  matchAny,
  matchGlob,
} from "../../../src/common/pattern-utils.ts";

Deno.test("pattern-utils: globToRegex handles literals, wildcards, and path depth", () => {
  const cases = [
    [globToRegex("hello.txt"), "hello.txt", true],
    [globToRegex("hello.txt"), "hello.js", false],
    [globToRegex("*.txt", { matchPath: false }), "dir/file.txt", true],
    [globToRegex("*.txt", { matchPath: true }), "dir/file.txt", false],
    [globToRegex("**/*.txt"), "dir/sub/file.txt", true],
    [globToRegex("file?.txt", { matchPath: false }), "file12.txt", false],
    [globToRegex("file?", { matchPath: true }), "file1", true],
  ] as const;

  for (const [regex, input, expected] of cases) {
    assertEquals(regex.test(input), expected, `${regex} :: ${input}`);
  }
});

Deno.test("pattern-utils: character classes, negation, and case sensitivity behave correctly", () => {
  const digitSet = globToRegex("file[123].txt");
  const range = globToRegex("file[a-z].txt");
  const negated = globToRegex("file[!123].txt");
  const insensitive = globToRegex("*.txt", { caseSensitive: false });

  assertEquals(digitSet.test("file2.txt"), true);
  assertEquals(digitSet.test("file4.txt"), false);
  assertEquals(range.test("filea.txt"), true);
  assertEquals(range.test("fileA.txt"), false);
  assertEquals(negated.test("filea.txt"), true);
  assertEquals(negated.test("file1.txt"), false);
  assertEquals(insensitive.test("file.TXT"), true);
});

Deno.test("pattern-utils: matchGlob covers path matching, dotfiles, empty input, and escaped literals", () => {
  const cases = [
    ["src/utils/helper.ts", "src/**/*.ts", { matchPath: true }, true],
    ["tests/foo.ts", "src/**/*.ts", { matchPath: true }, false],
    [".gitignore", ".*", undefined, true],
    ["", "*", undefined, true],
    ["", "?", undefined, false],
    ["file(1).txt", "file(1).txt", undefined, true],
    ["file1.txt", "file[1].txt", undefined, true],
  ] as const;

  for (const [input, pattern, options, expected] of cases) {
    assertEquals(matchGlob(input, pattern, options), expected, `${input} :: ${pattern}`);
  }
});

Deno.test("pattern-utils: matchAny supports string and RegExp pattern sets", () => {
  assertEquals(matchAny("file.ts", ["*.ts", "*.tsx", "*.js"]), true);
  assertEquals(matchAny("file.py", ["*.ts", "*.tsx", "*.js"]), false);
  assertEquals(matchAny("file.ts", [/.*\.ts$/, /.*\.js$/]), true);
  assertEquals(matchAny("file.py", []), false);
});

Deno.test("pattern-utils: filterByGlob preserves order and returns only matching entries", () => {
  const files = ["c.ts", "a.ts", "bar.js", "b.ts", "qux.py"];
  assertEquals(filterByGlob(files, "*.ts"), ["c.ts", "a.ts", "b.ts"]);
  assertEquals(filterByGlob(["foo.js", "bar.py"], "*.ts"), []);
});

Deno.test("pattern-utils: invalid patterns throw GlobPatternError", () => {
  assertThrows(() => globToRegex(""), GlobPatternError, "Empty pattern");
});
