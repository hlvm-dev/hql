/**
 * Tests for parseDiffLines() — the diff parser used by DiffRenderer.
 *
 * Written against the hand-rolled parser first, then verified against
 * the `diff` library replacement.
 */

import { assertEquals } from "jsr:@std/assert";
import { parseDiffLines } from "../../../src/hlvm/cli/repl-ink/components/conversation/DiffRenderer.tsx";
import type { DiffLine } from "../../../src/hlvm/cli/repl-ink/components/conversation/DiffRenderer.tsx";

// ============================================================
// Test 1: Simple single-file diff
// ============================================================

Deno.test("parseDiffLines: single file with adds and dels", () => {
  const diff = `diff --git a/hello.ts b/hello.ts
--- a/hello.ts
+++ b/hello.ts
@@ -1,3 +1,3 @@
 const a = 1;
-const b = 2;
+const b = 3;
 const c = 4;`;

  const lines = parseDiffLines(diff);

  // File headers
  assertEquals(lines[0], { type: "file-header", content: "diff --git a/hello.ts b/hello.ts" });
  assertEquals(lines[1], { type: "file-header", content: "--- a/hello.ts" });
  assertEquals(lines[2], { type: "file-header", content: "+++ b/hello.ts" });

  // Hunk header
  assertEquals(lines[3], { type: "hunk-header", content: "@@ -1,3 +1,3 @@" });

  // Context, del, add, context
  assertEquals(lines[4], { type: "context", content: "const a = 1;", oldLineNum: 1, newLineNum: 1 });
  assertEquals(lines[5], { type: "del", content: "const b = 2;", oldLineNum: 2 });
  assertEquals(lines[6], { type: "add", content: "const b = 3;", newLineNum: 2 });
  assertEquals(lines[7], { type: "context", content: "const c = 4;", oldLineNum: 3, newLineNum: 3 });
});

// ============================================================
// Test 2: New file (all additions)
// ============================================================

Deno.test("parseDiffLines: new file with all additions", () => {
  const diff = `diff --git a/new.ts b/new.ts
new file mode 100644
--- /dev/null
+++ b/new.ts
@@ -0,0 +1,3 @@
+line one
+line two
+line three`;

  const lines = parseDiffLines(diff);

  const addLines = lines.filter((l: DiffLine) => l.type === "add");
  assertEquals(addLines.length, 3);
  assertEquals(addLines[0], { type: "add", content: "line one", newLineNum: 1 });
  assertEquals(addLines[1], { type: "add", content: "line two", newLineNum: 2 });
  assertEquals(addLines[2], { type: "add", content: "line three", newLineNum: 3 });
});

// ============================================================
// Test 3: Multiple hunks in one file
// ============================================================

Deno.test("parseDiffLines: multiple hunks", () => {
  const diff = `diff --git a/multi.ts b/multi.ts
--- a/multi.ts
+++ b/multi.ts
@@ -1,3 +1,3 @@
 top line
-old middle
+new middle
 bottom line
@@ -10,3 +10,3 @@
 line ten
-old eleven
+new eleven
 line twelve`;

  const lines = parseDiffLines(diff);

  const hunkHeaders = lines.filter((l: DiffLine) => l.type === "hunk-header");
  assertEquals(hunkHeaders.length, 2);

  // Second hunk starts at line 10
  const secondHunkIdx = lines.indexOf(hunkHeaders[1]);
  const nextLine = lines[secondHunkIdx + 1];
  assertEquals(nextLine?.type, "context");
  assertEquals(nextLine?.oldLineNum, 10);
  assertEquals(nextLine?.newLineNum, 10);
});

// ============================================================
// Test 4: Multi-file diff
// ============================================================

Deno.test("parseDiffLines: multi-file diff", () => {
  const diff = `diff --git a/a.ts b/a.ts
--- a/a.ts
+++ b/a.ts
@@ -1,2 +1,2 @@
 hello
-world
+earth
diff --git a/b.ts b/b.ts
--- a/b.ts
+++ b/b.ts
@@ -1,2 +1,2 @@
 foo
-bar
+baz`;

  const lines = parseDiffLines(diff);

  const fileHeaders = lines.filter(
    (l: DiffLine) => l.type === "file-header" && l.content.startsWith("diff --git"),
  );
  assertEquals(fileHeaders.length, 2);

  // Second file's del should have oldLineNum=2 (reset per file)
  const dels = lines.filter((l: DiffLine) => l.type === "del");
  assertEquals(dels.length, 2);
  assertEquals(dels[0]?.content, "world");
  assertEquals(dels[1]?.content, "bar");
  assertEquals(dels[1]?.oldLineNum, 2);
});

// ============================================================
// Test 5: No-newline-at-end marker is skipped
// ============================================================

Deno.test("parseDiffLines: no-newline marker is skipped", () => {
  const diff = `diff --git a/f.ts b/f.ts
--- a/f.ts
+++ b/f.ts
@@ -1,1 +1,1 @@
-old
+new
\\ No newline at end of file`;

  const lines = parseDiffLines(diff);

  // The \\ line should be skipped — no DiffLine for it
  const contentLines = lines.filter(
    (l: DiffLine) => l.type !== "file-header" && l.type !== "hunk-header",
  );
  assertEquals(contentLines.length, 2); // just del + add
  assertEquals(contentLines[0]?.type, "del");
  assertEquals(contentLines[1]?.type, "add");
});

// ============================================================
// Test 6: Empty diff returns empty array
// ============================================================

Deno.test("parseDiffLines: empty string returns empty array", () => {
  assertEquals(parseDiffLines(""), []);
});

// ============================================================
// Test 7: Diff metadata lines (index, similarity, rename)
// ============================================================

Deno.test("parseDiffLines: metadata lines before hunk are file-headers", () => {
  const diff = `diff --git a/old.ts b/new.ts
similarity index 95%
rename from old.ts
rename to new.ts
--- a/old.ts
+++ b/new.ts
@@ -1,2 +1,2 @@
 unchanged
-removed
+added`;

  const lines = parseDiffLines(diff);

  const fileHeaders = lines.filter((l: DiffLine) => l.type === "file-header");
  // diff --git, similarity index, rename from, rename to, ---, +++
  assertEquals(fileHeaders.length, 6);

  const adds = lines.filter((l: DiffLine) => l.type === "add");
  assertEquals(adds.length, 1);
  assertEquals(adds[0]?.content, "added");
});
