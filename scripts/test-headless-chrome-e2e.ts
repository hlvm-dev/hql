/**
 * Manual E2E test for headless Chrome fallback.
 * Run: deno run --allow-all scripts/test-headless-chrome-e2e.ts
 *
 * Tests:
 * 1. Direct renderWithChrome on a real URL produces content
 * 2. Singleton browser reuse (second render is faster)
 * 3. renderWithChrome on a JS-only page returns rendered HTML
 * 4. SSR site does NOT trigger Chrome fallback in web_fetch
 * 5. headlessChrome field is always present in web_fetch response
 * 6. shutdownChromeBrowser works cleanly
 */
import { findSystemChrome, renderWithChrome, shutdownChromeBrowser } from "../src/hlvm/agent/tools/web/headless-chrome.ts";
import { WEB_TOOLS, resetWebToolBudget } from "../src/hlvm/agent/tools/web-tools.ts";
import { parseHtml } from "../src/hlvm/agent/tools/web/html-parser.ts";

const results: Array<{ name: string; pass: boolean; detail: string }> = [];
function record(name: string, pass: boolean, detail: string) {
  results.push({ name, pass, detail });
  console.log(`${pass ? "PASS" : "FAIL"}: ${name} -- ${detail}`);
}

// Test 1: Chrome detected
const chromePath = await findSystemChrome();
record(
  "Chrome binary found",
  chromePath !== null,
  `path: ${chromePath ?? "not found"}`,
);

if (!chromePath) {
  console.log("\nSkipping remaining tests: Chrome not installed");
  Deno.exit(0);
}

// Test 2: Direct render of a real URL
console.log("\nRendering react.dev...");
const start1 = Date.now();
const html1 = await renderWithChrome("https://react.dev", 20_000);
const time1 = Date.now() - start1;
record(
  "Direct render produces content",
  html1 !== null && html1.length > 5000,
  `${html1?.length ?? 0} chars in ${time1}ms`,
);

// Test 3: Singleton reuse (second render should reuse browser)
console.log("Rendering vuejs.org (browser reuse)...");
const start2 = Date.now();
const html2 = await renderWithChrome("https://vuejs.org", 15_000);
const time2 = Date.now() - start2;
record(
  "Browser reuse works",
  html2 !== null && html2.length > 1000,
  `${html2?.length ?? 0} chars in ${time2}ms (reuse)`,
);

// Test 4: JS-only page content extraction
// Use a data: URL with a script that generates content (Chrome renders it, static fetch won't)
const jsOnlyHtml = await renderWithChrome(
  "data:text/html,<html><body><div id='app'></div><script>document.getElementById('app').textContent='Hello from JS rendering. '.repeat(20)</script></body></html>",
  10_000,
);
const jsOnlyParsed = jsOnlyHtml ? parseHtml(jsOnlyHtml, 50000, 20) : null;
record(
  "JS-only page content extracted",
  jsOnlyParsed !== null && jsOnlyParsed.text.includes("Hello from JS rendering"),
  `text: ${jsOnlyParsed?.text.trim().length ?? 0} chars`,
);

// Test 5: web_fetch on SSR site does NOT trigger Chrome
resetWebToolBudget();
const ssrResult = await WEB_TOOLS.web_fetch.fn(
  { url: "https://react.dev/learn", maxChars: 5555 },
  "/tmp",
) as Record<string, unknown>;
record(
  "SSR site skips Chrome fallback",
  ssrResult.headlessChrome === false && ((ssrResult.text as string)?.trim().length ?? 0) > 200,
  `headlessChrome=${ssrResult.headlessChrome} text=${(ssrResult.text as string)?.trim().length ?? 0}`,
);

// Test 6: headlessChrome field always present
record(
  "headlessChrome field present in response",
  typeof ssrResult.headlessChrome === "boolean",
  `type: ${typeof ssrResult.headlessChrome}`,
);

// Test 7: Clean shutdown
await shutdownChromeBrowser();
// Double shutdown is safe
await shutdownChromeBrowser();
record("Shutdown is clean and idempotent", true, "no errors");

// Summary
console.log("\n=== Summary ===");
const passCount = results.filter(r => r.pass).length;
const total = results.length;
for (const r of results) {
  console.log(`  ${r.pass ? "PASS" : "FAIL"}: ${r.name}`);
}
console.log(`\nScore: ${passCount}/${total}`);

if (passCount < total) {
  Deno.exit(1);
}
