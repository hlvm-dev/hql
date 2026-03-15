import { assert, assertEquals } from "jsr:@std/assert";
import { parseHtml } from "../../../src/hlvm/agent/tools/web/html-parser.ts";
import { extractRelevantPassages } from "../../../src/hlvm/agent/tools/web/search-ranking.ts";

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
