import { assert, assertEquals, assertStringIncludes } from "jsr:@std/assert";
import { summarizeToolResult } from "../../../src/hlvm/agent/tool-result-summary.ts";
import { CODE_TOOLS } from "../../../src/hlvm/agent/tools/code-tools.ts";
import { FILE_TOOLS } from "../../../src/hlvm/agent/tools/file-tools.ts";
import { WEB_TOOLS } from "../../../src/hlvm/agent/tools/web-tools.ts";
import { MEMORY_TOOLS } from "../../../src/hlvm/memory/tools.ts";

Deno.test("summarizeToolResult prefers message on structured results", () => {
  assertEquals(
    summarizeToolResult("list_files", { success: true, message: "Listed 12 entries" }),
    "Listed 12 entries",
  );
});

Deno.test("summarizeToolResult falls back to count-based summary", () => {
  assertEquals(
    summarizeToolResult("search_code", { success: true, matches: [{ file: "a.ts" }], count: 3 }),
    "Found 3 matches",
  );
});

Deno.test("search_code formatter summarizes matches and top hit", () => {
  const formatResult = CODE_TOOLS.search_code.formatResult;
  assert(formatResult);
  const formatted = formatResult({
    success: true,
    matches: [
      { file: "src/a.ts", line: 18, content: "const hello = world" },
      { file: "src/b.ts", line: 3, content: "hello()" },
    ],
    count: 2,
    message: "Found 2 matches",
  });
  assert(formatted);
  assertStringIncludes(formatted.summaryDisplay ?? "", "Found 2 matches in 2 files");
  assertStringIncludes(formatted.summaryDisplay ?? "", "Top hit: src/a.ts:18");
  assertStringIncludes(formatted.returnDisplay, "[1] src/a.ts:18");
});

Deno.test("read_file formatter keeps summary short and detail rich", () => {
  const formatResult = FILE_TOOLS.read_file.formatResult;
  assert(formatResult);
  const formatted = formatResult({
    success: true,
    path: "src/main.ts",
    size: 42,
    content: "export const main = true;",
    message: "Read 42 bytes from src/main.ts",
  });
  assert(formatted);
  assertEquals(formatted.summaryDisplay, "Read 42 bytes from src/main.ts");
  assertStringIncludes(formatted.returnDisplay, "File: src/main.ts");
  assertStringIncludes(formatted.returnDisplay, "export const main = true;");
});

Deno.test("memory_search formatter summarizes misses cleanly", () => {
  const formatResult = MEMORY_TOOLS.memory_search.formatResult;
  assert(formatResult);
  const formatted = formatResult({
    query: "old bug",
    results: [],
    count: 0,
  });
  assert(formatted);
  assertEquals(formatted.summaryDisplay, "No memory results found");
  assertEquals(formatted.returnDisplay, "No memory results found");
});

Deno.test("fetch_url formatter summarizes fetch and keeps text in detail", () => {
  const formatResult = WEB_TOOLS.fetch_url.formatResult;
  assert(formatResult);
  const formatted = formatResult({
    url: "https://example.com",
    status: 200,
    ok: true,
    contentType: "text/html",
    bytes: 120,
    truncated: false,
    text: "Example Domain",
  });
  assert(formatted);
  assertEquals(formatted.summaryDisplay, "Fetched https://example.com");
  assertStringIncludes(formatted.returnDisplay, "URL: https://example.com");
  assertStringIncludes(formatted.returnDisplay, "Example Domain");
});
