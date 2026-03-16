import { assert, assertEquals } from "jsr:@std/assert";
import { parseHtml } from "../../../src/hlvm/agent/tools/web/html-parser.ts";
import { extractRelevantPassages } from "../../../src/hlvm/agent/tools/web/search-ranking.ts";

const MAX_TEXT = 10_000;
const MAX_LINKS = 0;

function extractText(html: string): string {
  return parseHtml(`<html><body>${html}</body></html>`, MAX_TEXT, MAX_LINKS).text;
}

Deno.test("web structured extraction: parseHtml preserves headings for passage grouping", () => {
  const parsed = parseHtml(
    `
      <html>
        <body>
          <article>
            <h2>Installation</h2>
            <p>Use npm install foo to add the package to your project.</p>
            <h2>Usage</h2>
            <p>Import foo and call setup() before rendering your app.</p>
          </article>
        </body>
      </html>
    `,
    2_000,
    5,
  );

  assert(parsed.text.includes("## Installation"));
  const passages = extractRelevantPassages("foo install package", parsed.text);
  assertEquals(passages.length >= 1, true);
  assert(passages[0]?.includes("## Installation"));
  assert(passages[0]?.includes("npm install foo"));
});

Deno.test("web structured extraction: parseHtml converts simple tables to markdown", () => {
  const parsed = parseHtml(
    `
      <html>
        <body>
          <article>
            <h2>Release Matrix</h2>
            <table>
              <thead>
                <tr><th>Version</th><th>Status</th></tr>
              </thead>
              <tbody>
                <tr><td>2.0</td><td>Stable</td></tr>
                <tr><td>2.1</td><td>Beta</td></tr>
              </tbody>
            </table>
          </article>
        </body>
      </html>
    `,
    2_000,
    5,
  );

  assert(parsed.text.includes("| Version | Status |"));
  assert(parsed.text.includes("| 2.0 | Stable |"));
  const passages = extractRelevantPassages("version status stable", parsed.text);
  assertEquals(passages.length >= 1, true);
  assert(
    passages.some((passage) =>
      passage.includes("| Version | Status |") && passage.includes("| 2.0 | Stable |")
    ),
  );
});

// ============================================================
// List / Blockquote / Definition List Extraction
// ============================================================

Deno.test("web structured extraction: unordered list → markdown bullets", () => {
  const text = extractText(`<ul><li>Alpha</li><li>Beta</li><li>Gamma</li></ul>`);
  assert(text.includes("- Alpha"), `Expected "- Alpha" in: ${text}`);
  assert(text.includes("- Beta"), `Expected "- Beta" in: ${text}`);
  assert(text.includes("- Gamma"), `Expected "- Gamma" in: ${text}`);
});

Deno.test("web structured extraction: ordered list → numbered items", () => {
  const text = extractText(`<ol><li>First</li><li>Second</li><li>Third</li></ol>`);
  assert(text.includes("1. First"), `Expected "1. First" in: ${text}`);
  assert(text.includes("2. Second"), `Expected "2. Second" in: ${text}`);
  assert(text.includes("3. Third"), `Expected "3. Third" in: ${text}`);
});

Deno.test("web structured extraction: nested lists → inner items converted", () => {
  const text = extractText(
    `<ul><li>Outer<ul><li>Inner A</li><li>Inner B</li></ul></li><li>Outer 2</li></ul>`,
  );
  assert(text.includes("- Inner A"), `Expected "- Inner A" in: ${text}`);
  assert(text.includes("- Inner B"), `Expected "- Inner B" in: ${text}`);
  assert(text.includes("- Outer"), `Expected "- Outer" in: ${text}`);
  assert(text.includes("- Outer 2"), `Expected "- Outer 2" in: ${text}`);
});

Deno.test("web structured extraction: blockquote → > prefix", () => {
  const text = extractText(`<blockquote>This is a quoted passage.</blockquote>`);
  assert(text.includes("> This is a quoted passage."), `Expected "> This is a quoted passage." in: ${text}`);
});

Deno.test("web structured extraction: definition list → bold term + : definition", () => {
  const text = extractText(
    `<dl><dt>API</dt><dd>Application Programming Interface</dd><dt>SDK</dt><dd>Software Development Kit</dd></dl>`,
  );
  assert(text.includes("**API**"), `Expected "**API**" in: ${text}`);
  assert(text.includes(": Application Programming Interface"), `Expected definition in: ${text}`);
  assert(text.includes("**SDK**"), `Expected "**SDK**" in: ${text}`);
  assert(text.includes(": Software Development Kit"), `Expected definition in: ${text}`);
});

Deno.test("web structured extraction: lists and blockquotes survive through passage extraction", () => {
  const result = parseHtml(
    `<html><body><article>
      <h2>Features</h2>
      <ul>
        <li>Fast startup time</li>
        <li>Low memory usage</li>
        <li>Cross-platform support</li>
      </ul>
      <blockquote>Performance matters.</blockquote>
    </article></body></html>`,
    MAX_TEXT,
    MAX_LINKS,
  );
  assert(result.text.includes("- Fast startup time"), `Expected list item in: ${result.text}`);
  assert(result.text.includes("- Low memory usage"), `Expected list item in: ${result.text}`);
  assert(result.text.includes("> Performance matters."), `Expected blockquote in: ${result.text}`);
  assert(result.text.includes("## Features"), `Expected heading in: ${result.text}`);
  const passages = extractRelevantPassages("fast startup cross-platform features", result.text);
  assertEquals(passages.length >= 1, true);
});
