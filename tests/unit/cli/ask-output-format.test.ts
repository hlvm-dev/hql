import { assertEquals, assertStringIncludes } from "jsr:@std/assert";
import {
  formatToolOutputForDefaultMode,
  summarizeToolEventForDefaultMode,
} from "../../../src/hlvm/cli/commands/ask.ts";

Deno.test("formatToolOutputForDefaultMode keeps short plain output", () => {
  const result = formatToolOutputForDefaultMode(
    "search_web",
    "Found 3 results\n1. A\n2. B\n3. C",
  );
  assertEquals(result.truncated, false);
  assertStringIncludes(result.text, "Found 3 results");
});

Deno.test("formatToolOutputForDefaultMode summarizes large markup", () => {
  const html = "<html><head><title>x</title></head><body>" +
    "<div>content</div>".repeat(200) +
    "</body></html>";
  const result = formatToolOutputForDefaultMode("mcp/playwright/render_url", html);
  assertEquals(result.truncated, true);
  assertEquals(result.text, "[mcp/playwright/render_url] Completed.");
});

Deno.test("formatToolOutputForDefaultMode truncates very long multiline output", () => {
  const content = Array.from({ length: 40 }, (_, i) => `line-${i} ${"x".repeat(80)}`)
    .join("\n");
  const result = formatToolOutputForDefaultMode("web_fetch", content);
  assertEquals(result.truncated, true);
  assertEquals(result.text, "[web_fetch] Completed.");
});

Deno.test("summarizeToolEventForDefaultMode prefers explicit summary", () => {
  const result = summarizeToolEventForDefaultMode(
    "search_code",
    "Found 12 matches in 4 files\nTop hit: src/app.ts:18",
    "{\"matches\":[...]}",
  );
  assertEquals(result, "Found 12 matches in 4 files");
});
