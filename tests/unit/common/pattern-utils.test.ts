/**
 * Tests for pattern-utils.ts
 *
 * Coverage:
 * - globToRegex() conversion
 * - matchGlob() matching
 * - matchAny() multiple patterns
 * - filterByGlob() array filtering
 * - Glob syntax: *, **, ?, [abc], [a-z], [!abc]
 * - Path-aware vs filename-only matching
 * - Case-sensitive vs case-insensitive
 * - Error cases
 */

import { assertEquals, assertThrows } from "jsr:@std/assert";
import {
  globToRegex,
  matchGlob,
  matchAny,
  filterByGlob,
  GlobPatternError,
} from "../../../src/common/pattern-utils.ts";

// ============================================================
// globToRegex() Basic Tests
// ============================================================

Deno.test("globToRegex - literal string", () => {
  const regex = globToRegex("hello.txt");
  assertEquals(regex.test("hello.txt"), true);
  assertEquals(regex.test("hello.js"), false);
});

Deno.test("globToRegex - * matches anything", () => {
  const regex = globToRegex("*.txt", { matchPath: false });
  assertEquals(regex.test("file.txt"), true);
  assertEquals(regex.test("file.js"), false);
  assertEquals(regex.test("dir/file.txt"), true); // matchPath: false
});

Deno.test("globToRegex - * in path mode excludes slashes", () => {
  const regex = globToRegex("*.txt", { matchPath: true });
  assertEquals(regex.test("file.txt"), true);
  assertEquals(regex.test("dir/file.txt"), false); // matchPath: true
});

Deno.test("globToRegex - ** matches any path depth", () => {
  const regex = globToRegex("**/*.txt");
  assertEquals(regex.test("file.txt"), true);
  assertEquals(regex.test("dir/file.txt"), true);
  assertEquals(regex.test("dir/sub/file.txt"), true);
  assertEquals(regex.test("file.js"), false);
});

Deno.test("globToRegex - ? matches single character", () => {
  const regex = globToRegex("file?.txt", { matchPath: false });
  assertEquals(regex.test("file1.txt"), true);
  assertEquals(regex.test("fileA.txt"), true);
  assertEquals(regex.test("file12.txt"), false);
});

Deno.test("globToRegex - ? in path mode excludes slashes", () => {
  const regex = globToRegex("file?", { matchPath: true });
  assertEquals(regex.test("file1"), true);
  assertEquals(regex.test("file/"), false);
});

Deno.test("globToRegex - [abc] matches character set", () => {
  const regex = globToRegex("file[123].txt");
  assertEquals(regex.test("file1.txt"), true);
  assertEquals(regex.test("file2.txt"), true);
  assertEquals(regex.test("file3.txt"), true);
  assertEquals(regex.test("file4.txt"), false);
});

Deno.test("globToRegex - [a-z] matches character range", () => {
  const regex = globToRegex("file[a-z].txt");
  assertEquals(regex.test("filea.txt"), true);
  assertEquals(regex.test("filez.txt"), true);
  assertEquals(regex.test("fileA.txt"), false); // case-sensitive
  assertEquals(regex.test("file1.txt"), false);
});

Deno.test("globToRegex - [!abc] matches negated set", () => {
  const regex = globToRegex("file[!123].txt");
  assertEquals(regex.test("filea.txt"), true);
  assertEquals(regex.test("file1.txt"), false);
  assertEquals(regex.test("file2.txt"), false);
});

// ============================================================
// Case Sensitivity Tests
// ============================================================

Deno.test("globToRegex - case-sensitive by default", () => {
  const regex = globToRegex("*.TXT");
  assertEquals(regex.test("file.TXT"), true);
  assertEquals(regex.test("file.txt"), false);
});

Deno.test("globToRegex - case-insensitive when requested", () => {
  const regex = globToRegex("*.txt", { caseSensitive: false });
  assertEquals(regex.test("file.txt"), true);
  assertEquals(regex.test("file.TXT"), true);
  assertEquals(regex.test("file.TxT"), true);
});

// ============================================================
// Complex Pattern Tests
// ============================================================

Deno.test("globToRegex - src/**/*.ts matches nested TypeScript files", () => {
  const regex = globToRegex("src/**/*.ts");
  assertEquals(regex.test("src/main.ts"), true);
  assertEquals(regex.test("src/utils/helper.ts"), true);
  assertEquals(regex.test("src/deep/nested/module.ts"), true);
  assertEquals(regex.test("tests/test.ts"), false);
  assertEquals(regex.test("src/main.js"), false);
});

Deno.test("globToRegex - tests/**/*.test.ts matches test files", () => {
  const regex = globToRegex("tests/**/*.test.ts");
  assertEquals(regex.test("tests/unit/foo.test.ts"), true);
  assertEquals(regex.test("tests/integration/bar.test.ts"), true);
  assertEquals(regex.test("tests/foo.ts"), false);
  assertEquals(regex.test("src/foo.test.ts"), false);
});

Deno.test("globToRegex - *.{ts,tsx} equivalent patterns", () => {
  // Note: Our implementation doesn't support {a,b} syntax yet
  // This tests workaround with multiple patterns
  const tsRegex = globToRegex("*.ts");
  const tsxRegex = globToRegex("*.tsx");

  assertEquals(tsRegex.test("file.ts"), true);
  assertEquals(tsxRegex.test("file.tsx"), true);
});

Deno.test("globToRegex - [0-9]* matches files starting with digit", () => {
  const regex = globToRegex("[0-9]*");
  assertEquals(regex.test("123.txt"), true);
  assertEquals(regex.test("01-intro.md"), true);
  assertEquals(regex.test("file.txt"), false);
});

// ============================================================
// matchGlob() Convenience Function Tests
// ============================================================

Deno.test("matchGlob - simple filename match", () => {
  assertEquals(matchGlob("test.ts", "*.ts"), true);
  assertEquals(matchGlob("test.js", "*.ts"), false);
});

Deno.test("matchGlob - path match", () => {
  assertEquals(
    matchGlob("src/utils/helper.ts", "src/**/*.ts", { matchPath: true }),
    true,
  );
  assertEquals(
    matchGlob("tests/foo.ts", "src/**/*.ts", { matchPath: true }),
    false,
  );
});

Deno.test("matchGlob - case-insensitive match", () => {
  assertEquals(
    matchGlob("README.MD", "*.md", { caseSensitive: false }),
    true,
  );
});

// ============================================================
// matchAny() Multiple Pattern Tests
// ============================================================

Deno.test("matchAny - matches first pattern", () => {
  const patterns = ["*.ts", "*.tsx", "*.js"];
  assertEquals(matchAny("file.ts", patterns), true);
});

Deno.test("matchAny - matches middle pattern", () => {
  const patterns = ["*.ts", "*.tsx", "*.js"];
  assertEquals(matchAny("file.tsx", patterns), true);
});

Deno.test("matchAny - matches last pattern", () => {
  const patterns = ["*.ts", "*.tsx", "*.js"];
  assertEquals(matchAny("file.js", patterns), true);
});

Deno.test("matchAny - no match returns false", () => {
  const patterns = ["*.ts", "*.tsx", "*.js"];
  assertEquals(matchAny("file.py", patterns), false);
});

Deno.test("matchAny - empty patterns returns false", () => {
  assertEquals(matchAny("file.ts", []), false);
});

Deno.test("matchAny - accepts compiled RegExp", () => {
  const patterns = [/.*\.ts$/, /.*\.js$/];
  assertEquals(matchAny("file.ts", patterns), true);
  assertEquals(matchAny("file.js", patterns), true);
  assertEquals(matchAny("file.py", patterns), false);
});

// ============================================================
// filterByGlob() Array Filtering Tests
// ============================================================

Deno.test("filterByGlob - filters array of strings", () => {
  const files = ["foo.ts", "bar.js", "baz.ts", "qux.py"];
  const result = filterByGlob(files, "*.ts");

  assertEquals(result, ["foo.ts", "baz.ts"]);
});

Deno.test("filterByGlob - returns empty array when no matches", () => {
  const files = ["foo.js", "bar.py"];
  const result = filterByGlob(files, "*.ts");

  assertEquals(result, []);
});

Deno.test("filterByGlob - returns all when all match", () => {
  const files = ["foo.ts", "bar.ts", "baz.ts"];
  const result = filterByGlob(files, "*.ts");

  assertEquals(result, files);
});

Deno.test("filterByGlob - preserves order", () => {
  const files = ["c.ts", "a.ts", "b.ts"];
  const result = filterByGlob(files, "*.ts");

  assertEquals(result, ["c.ts", "a.ts", "b.ts"]);
});

// ============================================================
// Error Cases
// ============================================================

Deno.test("globToRegex - empty pattern throws", () => {
  assertThrows(
    () => globToRegex(""),
    GlobPatternError,
    "Empty pattern",
  );
});


// ============================================================
// Real-World Test Cases
// ============================================================

Deno.test("matchGlob - TypeScript source files", () => {
  assertEquals(matchGlob("src/main.ts", "src/**/*.ts"), true);
  assertEquals(matchGlob("src/utils/helper.ts", "src/**/*.ts"), true);
  assertEquals(matchGlob("tests/test.ts", "src/**/*.ts"), false);
});

Deno.test("matchGlob - test files pattern", () => {
  assertEquals(matchGlob("foo.test.ts", "*.test.ts"), true);
  assertEquals(matchGlob("bar.spec.ts", "*.test.ts"), false);
});

Deno.test("matchGlob - ignore files pattern", () => {
  assertEquals(matchGlob(".gitignore", ".*"), true);
  assertEquals(matchGlob(".env", ".*"), true);
  assertEquals(matchGlob("file.txt", ".*"), false);
});

Deno.test("matchGlob - documentation files", () => {
  assertEquals(
    matchGlob("README.md", "*.md", { caseSensitive: false }),
    true,
  );
  assertEquals(
    matchGlob("docs/guide.md", "**/*.md"),
    true,
  );
});

// ============================================================
// Edge Cases
// ============================================================

Deno.test("matchGlob - single character filename", () => {
  assertEquals(matchGlob("a", "?"), true);
  assertEquals(matchGlob("ab", "?"), false);
});

Deno.test("matchGlob - empty string input", () => {
  assertEquals(matchGlob("", "*"), true);
  assertEquals(matchGlob("", "?"), false);
  assertEquals(matchGlob("", "a"), false);
});

Deno.test("matchGlob - pattern with literal dot", () => {
  assertEquals(matchGlob("file.txt", "file.txt"), true);
  assertEquals(matchGlob("fileXtxt", "file.txt"), false);
});

Deno.test("matchGlob - pattern with special regex chars escaped", () => {
  assertEquals(matchGlob("file(1).txt", "file(1).txt"), true);
  // [1] in glob is a character class that matches '1', so:
  assertEquals(matchGlob("file1.txt", "file[1].txt"), true);
  // To match literal '[1]', you'd need to escape: file\[1\].txt
});

// ============================================================
// Path vs Filename Mode Tests
// ============================================================

Deno.test("matchGlob - matchPath:true restricts * to non-slash", () => {
  assertEquals(
    matchGlob("dir/file.ts", "*.ts", { matchPath: true }),
    false,
  );
  assertEquals(
    matchGlob("file.ts", "*.ts", { matchPath: true }),
    true,
  );
});

Deno.test("matchGlob - matchPath:false allows * to match slash", () => {
  assertEquals(
    matchGlob("dir/file.ts", "*.ts", { matchPath: false }),
    true,
  );
});

Deno.test("matchGlob - ** always matches across paths", () => {
  assertEquals(
    matchGlob("a/b/c/file.ts", "**/*.ts", { matchPath: true }),
    true,
  );
  assertEquals(
    matchGlob("a/b/c/file.ts", "**/*.ts", { matchPath: false }),
    true,
  );
});

// ============================================================
// Performance/Stress Tests
// ============================================================

Deno.test("filterByGlob - handles large array efficiently", () => {
  const files = Array.from({ length: 1000 }, (_, i) =>
    i % 2 === 0 ? `file${i}.ts` : `file${i}.js`
  );

  const start = performance.now();
  const result = filterByGlob(files, "*.ts");
  const duration = performance.now() - start;

  assertEquals(result.length, 500);
  assertEquals(duration < 100, true); // Should be fast (< 100ms)
});

Deno.test("globToRegex - handles complex nested patterns", () => {
  const regex = globToRegex("**/src/**/*.test.ts");

  assertEquals(regex.test("src/foo.test.ts"), true);
  assertEquals(regex.test("app/src/utils/foo.test.ts"), true);
  assertEquals(regex.test("src/utils/foo.test.js"), false);
});
