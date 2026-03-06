/**
 * Unit tests for conversation display helpers.
 */

import { assertEquals } from "jsr:@std/assert@1";
import {
  detectContentType,
  tryFormatJson,
} from "../../../src/hlvm/cli/repl-ink/components/conversation/ToolResult.tsx";
import {
  parseDiffLines,
} from "../../../src/hlvm/cli/repl-ink/components/conversation/DiffRenderer.tsx";
import {
  buildCitationRenderView,
} from "../../../src/hlvm/cli/repl-ink/components/conversation/AssistantMessage.tsx";
import {
  resolveToolResultText,
} from "../../../src/hlvm/cli/repl-ink/components/conversation/ToolCallItem.tsx";

Deno.test("detectContentType - identifies diff", () => {
  const diff = `diff --git a/a.ts b/a.ts\n@@ -1,1 +1,1 @@\n-old\n+new`;
  assertEquals(detectContentType(diff), "diff");
});

Deno.test("detectContentType - identifies json", () => {
  assertEquals(detectContentType(`{"ok":true}`), "json");
  assertEquals(detectContentType(`[1,2,3]`), "json");
});

Deno.test("detectContentType - defaults to plain", () => {
  assertEquals(detectContentType("plain text output"), "plain");
});

Deno.test("detectContentType - invalid JSON-like text stays plain", () => {
  assertEquals(detectContentType("{not-json}"), "plain");
  assertEquals(detectContentType("[broken"), "plain");
});

Deno.test("detectContentType - plain output starting with --- is not diff", () => {
  assertEquals(
    detectContentType(`---\nfrontmatter: true\n---\nhello`),
    "plain",
  );
});

Deno.test("detectContentType - file headers require both sides for diff", () => {
  assertEquals(detectContentType("--- a/file.ts"), "plain");
  assertEquals(detectContentType("+++ b/file.ts"), "plain");
  assertEquals(
    detectContentType("--- a/file.ts\n+++ b/file.ts\n@@ -1,1 +1,1 @@\n-a\n+b"),
    "diff",
  );
});

Deno.test("tryFormatJson - pretty prints valid json", () => {
  const formatted = tryFormatJson(`{"a":1,"b":{"c":2}}`);
  assertEquals(
    formatted,
    `{\n  "a": 1,\n  "b": {\n    "c": 2\n  }\n}`,
  );
});

Deno.test("tryFormatJson - returns null for invalid json", () => {
  assertEquals(tryFormatJson("{bad"), null);
});

Deno.test("parseDiffLines - parses unified diff with line numbers", () => {
  const diff = [
    "--- a/example.ts",
    "+++ b/example.ts",
    "@@ -1,2 +1,3 @@",
    " line1",
    "-line2",
    "+line2 updated",
    "+line3",
  ].join("\n");

  const lines = parseDiffLines(diff);

  assertEquals(lines[0].type, "file-header");
  assertEquals(lines[1].type, "file-header");
  assertEquals(lines[2].type, "hunk-header");

  assertEquals(lines[3].type, "context");
  assertEquals(lines[3].oldLineNum, 1);
  assertEquals(lines[3].newLineNum, 1);

  assertEquals(lines[4].type, "del");
  assertEquals(lines[4].oldLineNum, 2);
  assertEquals(lines[4].newLineNum, undefined);

  assertEquals(lines[5].type, "add");
  assertEquals(lines[5].oldLineNum, undefined);
  assertEquals(lines[5].newLineNum, 2);

  assertEquals(lines[6].type, "add");
  assertEquals(lines[6].newLineNum, 3);
});

Deno.test("parseDiffLines - ignores metadata before first hunk", () => {
  const diff = [
    "diff --git a/a.ts b/a.ts",
    "index 123..456 100644",
    "--- a/a.ts",
    "+++ b/a.ts",
    "@@ -3,1 +3,1 @@",
    "-x",
    "+y",
  ].join("\n");

  const lines = parseDiffLines(diff);
  assertEquals(lines.some((l) => l.content.startsWith("diff --git")), false);
  assertEquals(lines.some((l) => l.type === "hunk-header"), true);
});

Deno.test("buildCitationRenderView - injects markers and builds source list", () => {
  const text = "NIST updated AI RMF guidance in 2025.";
  const view = buildCitationRenderView(text, [
    {
      url: "https://www.nist.gov/ai-rmf",
      title: "NIST AI RMF",
      startIndex: 0,
      endIndex: 32,
      confidence: 0.84,
      sourceKind: "passage",
    },
  ]);

  assertEquals(view.text.includes("[1]"), true);
  assertEquals(view.sources.length, 1);
  assertEquals(view.sources[0]?.index, 1);
  assertEquals(view.sources[0]?.url, "https://www.nist.gov/ai-rmf");
});

Deno.test("buildCitationRenderView - groups multiple spans from same URL", () => {
  const text = "Sentence one. Sentence two.";
  const view = buildCitationRenderView(text, [
    {
      url: "https://example.com/doc",
      title: "Doc",
      startIndex: 0,
      endIndex: 12,
      confidence: 0.5,
    },
    {
      url: "https://example.com/doc",
      title: "Doc",
      startIndex: 13,
      endIndex: 26,
      confidence: 0.7,
    },
  ]);

  assertEquals(view.sources.length, 1);
  assertEquals(view.sources[0]?.spans.length, 2);
  assertEquals(view.sources[0]?.confidence, 0.7);
});

Deno.test("resolveToolResultText prefers summary when collapsed", () => {
  assertEquals(
    resolveToolResultText(
      {
        resultSummaryText: "Found 12 matches in 4 files",
        resultText: "{\n  \"matches\": [ ... ]\n}",
      },
      false,
    ),
    "Found 12 matches in 4 files",
  );
});

Deno.test("resolveToolResultText uses full detail when expanded", () => {
  assertEquals(
    resolveToolResultText(
      {
        resultSummaryText: "Found 12 matches in 4 files",
        resultText: "{\n  \"matches\": [ ... ]\n}",
      },
      true,
    ),
    "{\n  \"matches\": [ ... ]\n}",
  );
});
