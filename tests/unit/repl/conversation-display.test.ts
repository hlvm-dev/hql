import { assertEquals } from "jsr:@std/assert";
import {
  buildCitationRenderView,
} from "../../../src/hlvm/cli/repl-ink/components/conversation/AssistantMessage.tsx";
import {
  parseDiffLines,
} from "../../../src/hlvm/cli/repl-ink/components/conversation/DiffRenderer.tsx";
import {
  resolveToolResultText,
} from "../../../src/hlvm/cli/repl-ink/components/conversation/ToolCallItem.tsx";
import {
  detectContentType,
  tryFormatJson,
} from "../../../src/hlvm/cli/repl-ink/components/conversation/ToolResult.tsx";

Deno.test("conversation display: detectContentType distinguishes diff, json, and plain text", () => {
  const diff = `diff --git a/a.ts b/a.ts\n@@ -1,1 +1,1 @@\n-old\n+new`;

  assertEquals(detectContentType(diff), "diff");
  assertEquals(detectContentType(`{"ok":true}`), "json");
  assertEquals(detectContentType(`[1,2,3]`), "json");
  assertEquals(detectContentType("{not-json}"), "plain");
  assertEquals(detectContentType(`---\nfrontmatter: true\n---\nhello`), "plain");
});

Deno.test("conversation display: tryFormatJson pretty-prints valid input and rejects invalid input", () => {
  assertEquals(
    tryFormatJson(`{"a":1,"b":{"c":2}}`),
    `{\n  "a": 1,\n  "b": {\n    "c": 2\n  }\n}`,
  );
  assertEquals(tryFormatJson("{bad"), null);
});

Deno.test("conversation display: parseDiffLines preserves line-number metadata and ignores pre-hunk headers", () => {
  const lines = parseDiffLines([
    "diff --git a/a.ts b/a.ts",
    "index 123..456 100644",
    "--- a/example.ts",
    "+++ b/example.ts",
    "@@ -1,2 +1,3 @@",
    " line1",
    "-line2",
    "+line2 updated",
    "+line3",
  ].join("\n"));

  assertEquals(lines[0].type, "file-header");
  assertEquals(lines[1].type, "file-header");
  assertEquals(lines[2].type, "file-header");
  assertEquals(lines[3].type, "hunk-header");
  assertEquals(lines[4].type, "context");
  assertEquals(lines[4].oldLineNum, 1);
  assertEquals(lines[4].newLineNum, 1);
  assertEquals(lines[5].type, "del");
  assertEquals(lines[5].oldLineNum, 2);
  assertEquals(lines[6].type, "add");
  assertEquals(lines[6].newLineNum, 2);
  assertEquals(lines.some((line) => line.content.startsWith("diff --git")), false);
});

Deno.test("conversation display: buildCitationRenderView injects markers and groups repeated URLs", () => {
  const text = "Sentence one. Sentence two.";
  const view = buildCitationRenderView(text, [
    {
      url: "https://example.com/doc",
      title: "Doc",
      startIndex: 0,
      endIndex: 12,
      confidence: 0.5,
      sourceKind: "passage",
    },
    {
      url: "https://example.com/doc",
      title: "Doc",
      startIndex: 13,
      endIndex: 26,
      confidence: 0.7,
      sourceKind: "passage",
    },
  ]);

  assertEquals(view.text.includes("[1]"), true);
  assertEquals(view.sources.length, 1);
  assertEquals(view.sources[0]?.index, 1);
  assertEquals(view.sources[0]?.spans.length, 2);
  assertEquals(view.sources[0]?.confidence, 0.7);
});

Deno.test("conversation display: buildCitationRenderView keeps source-only native citations without inline markers", () => {
  const text = "Grounded answer without inline span metadata.";
  const view = buildCitationRenderView(text, [
    {
      url: "https://ai.google.dev/gemini-api/docs/google-search",
      title: "Google Search grounding",
      provenance: "provider",
      sourceType: "url",
      sourceId: "src_1",
    },
  ]);

  assertEquals(view.text, text);
  assertEquals(view.sources.length, 1);
  assertEquals(view.sources[0]?.title, "Google Search grounding");
  assertEquals(view.sources[0]?.spans.length, 0);
});

Deno.test("conversation display: resolveToolResultText switches between summary and full output", () => {
  const payload = {
    resultSummaryText: "Found 12 matches in 4 files",
    resultText: "{\n  \"matches\": [ ... ]\n}",
  };

  assertEquals(resolveToolResultText(payload, false), "Found 12 matches in 4 files");
  assertEquals(resolveToolResultText(payload, true), "{\n  \"matches\": [ ... ]\n}");
});
