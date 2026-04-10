/**
 * Opt-in real-world browser semantic evaluation.
 *
 * Purpose:
 * - Validate browser tasks by answer adequacy and tool-family usage
 * - Avoid counting "stream completed" as success
 * - Grade the source runner's accepted terminal answer, not raw streamed text
 * - Benchmark PW-first browser_safe behavior on real sites
 *
 * Run:
 *   HLVM_E2E_BROWSER_SEMANTIC=1 \
 *   HLVM_LIVE_AGENT_MODEL=claude-haiku-4-5-20251001 \
 *   deno test --allow-all tests/e2e/browser-semantic-eval.test.ts
 */

import { assertEquals } from "jsr:@std/assert";
import type { AgentUIEvent } from "../../src/hlvm/agent/orchestrator.ts";
import { getPlatform } from "../../src/platform/platform.ts";
import {
  runSourceAgentWithCompatibleModel,
  withTemporaryWorkspace,
} from "./native-provider-smoke-helpers.ts";

const platform = getPlatform();
const ENABLED = platform.env.get("HLVM_E2E_BROWSER_SEMANTIC") === "1";
const CASE_FILTER = platform.env.get("HLVM_E2E_BROWSER_CASE")?.trim() ?? "";
const TIMEOUT_MS = 420_000;
const DEFAULT_MODEL_CANDIDATES = [
  "claude-code/claude-haiku-4-5-20251001",
  "claude-code/claude-haiku-4-5-20251001:agent",
  "claude-haiku-4.5",
  "claude-haiku-4-5-20251001",
  "claude-haiku-4-5-20251001:agent",
];
const liveModel = platform.env.get("HLVM_LIVE_AGENT_MODEL")?.trim() ?? "";
const MODEL_CANDIDATES = [
  ...new Set([liveModel, ...DEFAULT_MODEL_CANDIDATES].filter((value) =>
    value.length > 0
  )),
];

interface BrowserSemanticCase {
  id: string;
  query: string;
  expectedPwOnly: boolean;
  validate: (
    result: BrowserSemanticResult,
  ) => Promise<string[]> | string[];
}

interface BrowserSemanticResult {
  text: string;
  /** text with markdown bold/italic/heading markers stripped for easier regex matching */
  plain: string;
  toolNames: string[];
  usedCu: boolean;
  usedPwPromote: boolean;
}

/** Strip markdown bold/italic/heading markers for validator matching. */
function stripMarkdown(text: string): string {
  return text
    .replace(/^#{1,3}\s+/gm, "")
    .replace(/\*{1,2}([^*]+)\*{1,2}/g, "$1");
}

function collectToolNames(events: AgentUIEvent[]): string[] {
  return events
    .filter((event): event is Extract<AgentUIEvent, { type: "tool_end" }> =>
      event.type === "tool_end"
    )
    .map((event) => event.name);
}

function validatePwOnlyUsage(
  result: BrowserSemanticResult,
  expectedPwOnly: boolean,
): string[] {
  if (!expectedPwOnly) return [];
  const errors: string[] = [];
  if (result.usedCu) errors.push("Expected PW-only execution but cu_* tools were used.");
  if (result.usedPwPromote) {
    errors.push("Expected PW-only execution but pw_promote was used.");
  }
  return errors;
}

async function validateDownloadResponse(
  result: BrowserSemanticResult,
  extensions: string[],
): Promise<string[]> {
  const errors: string[] = [];
  const filePattern = new RegExp(
    `\\b[^\\s/]+\\.(?:${extensions.map((ext) => ext.replace(".", "")).join("|")})\\b`,
    "i",
  );
  const savedToMatch = result.text.match(/\*{0,2}Saved to:?\*{0,2}\s*(.+)$/im) ??
    result.text.match(/`(\/[^`]+)`/);
  if (!filePattern.test(result.text)) {
    errors.push("Missing downloaded filename in final answer.");
  }
  if (!savedToMatch?.[1]) {
    errors.push("Missing saved path in final answer.");
  } else {
    try {
      const path = savedToMatch[1].trim();
      const info = await platform.fs.stat(path);
      if (!info.isFile) errors.push(`Saved path is not a file: ${path}`);
    } catch {
      errors.push(`Saved file does not exist: ${savedToMatch[1].trim()}`);
    }
  }
  return errors;
}

function validateCountAndTitle(result: BrowserSemanticResult): string[] {
  const errors: string[] = [];
  if (!/(?:^#{1,3}\s*)?(?:\*{0,2})Count:?(?:\*{0,2})\s*\d+/im.test(result.text)) {
    errors.push("Missing numeric count line.");
  }
  if (!/(?:^#{1,3}\s*)?(?:\*{0,2})First:?(?:\*{0,2})\s*\S.+/im.test(result.text)) {
    errors.push("Missing first-title line.");
  }
  return errors;
}

function hasSectionWithContent(
  text: string,
  label: string,
  minContentLength: number,
): boolean {
  const pattern = new RegExp(
    `(?:^#{1,3}\\s*${label}|^\\*{0,2}${label}:?\\*{0,2})\\s*\\n+(.+)`,
    "im",
  );
  const match = pattern.exec(text);
  if (match?.[1] && match[1].trim().length >= minContentLength) return true;
  const inline = new RegExp(
    `^\\*{0,2}${label}:?\\*{0,2}\\s+(\\S.{${minContentLength},})`,
    "im",
  );
  return inline.test(text);
}

function validateParagraphAndExample(result: BrowserSemanticResult): string[] {
  const errors: string[] = [];
  if (!hasSectionWithContent(result.text, "Paragraph", 40)) {
    errors.push("Missing substantial paragraph section.");
  }
  if (!/```[\s\S]{10,}/.test(result.text)) {
    errors.push("Missing fenced code example.");
  }
  return errors;
}

function validateHeadingAndExample(result: BrowserSemanticResult): string[] {
  const errors: string[] = [];
  if (!hasSectionWithContent(result.text, "Heading", 3)) {
    errors.push("Missing heading section.");
  }
  if (!/```[\s\S]{10,}/.test(result.text)) {
    errors.push("Missing fenced code example.");
  }
  return errors;
}

function validateTopThreeTitles(result: BrowserSemanticResult): string[] {
  const errors: string[] = [];
  const numbered = result.text.split("\n").filter((line) =>
    /^\d+\.\s+\S/.test(line.trim())
  );
  if (numbered.length < 3) {
    errors.push("Missing three numbered search results.");
  }
  return errors;
}

function validateHttpbinEcho(result: BrowserSemanticResult): string[] {
  const required = [
    "John",
    "555-1234",
    "john@test.com",
    "large",
    "bacon",
    "cheese",
    "Extra napkins",
  ];
  return required.filter((token) => !result.text.includes(token)).map((token) =>
    `Missing echoed form value: ${token}`
  );
}

const CASES: BrowserSemanticCase[] = [
  {
    id: "python_installer",
    query:
      "Go to python.org and download the latest stable macOS 64-bit universal2 installer. Answer with exactly two lines: Filename: <name> and Saved to: <absolute path>.",
    expectedPwOnly: true,
    validate: async (result) => [
      ...validatePwOnlyUsage(result, true),
      ...await validateDownloadResponse(result, [".pkg"]),
    ],
  },
  {
    id: "node_lts_installer",
    query:
      "Go to nodejs.org and download the latest Node.js LTS macOS pkg installer. Answer with exactly two lines: Filename: <name> and Saved to: <absolute path>.",
    expectedPwOnly: true,
    validate: async (result) => [
      ...validatePwOnlyUsage(result, true),
      ...await validateDownloadResponse(result, [".pkg"]),
    ],
  },
  {
    id: "github_issues",
    query:
      "Open https://github.com/denoland/deno/issues and answer with exactly two lines: Count: <open issues count on the page> and First: <title of the first visible issue>.",
    expectedPwOnly: true,
    validate: (result) => [
      ...validatePwOnlyUsage(result, true),
      ...validateCountAndTitle(result),
    ],
  },
  {
    id: "deno_fetch_docs",
    query:
      "Open the Deno fetch docs page and answer with exactly two sections: Heading: <page heading> and Example: a fenced code block containing the first fetch example.",
    expectedPwOnly: true,
    validate: (result) => [
      ...validatePwOnlyUsage(result, true),
      ...validateHeadingAndExample(result),
    ],
  },
  {
    id: "mdn_fetch_api",
    query:
      "Open the MDN Fetch API page. Answer with exactly two sections: Paragraph: <first paragraph under Concepts and usage> and Example: a fenced code block with the first example.",
    expectedPwOnly: true,
    validate: (result) => [
      ...validatePwOnlyUsage(result, true),
      ...validateParagraphAndExample(result),
    ],
  },
  {
    id: "hn_algolia_search",
    query:
      "Go to https://hn.algolia.com/, search for playwright, and return the first three result titles as a numbered list.",
    expectedPwOnly: true,
    validate: (result) => [
      ...validatePwOnlyUsage(result, true),
      ...validateTopThreeTitles(result),
    ],
  },
  {
    id: "httpbin_form_submit",
    query:
      "Open https://httpbin.org/forms/post, submit this form exactly: name John, telephone 555-1234, email john@test.com, size large, toppings bacon and cheese, comments Extra napkins. Then return the echoed submitted values.",
    expectedPwOnly: true,
    validate: (result) => [
      ...validatePwOnlyUsage(result, true),
      ...validateHttpbinEcho(result),
    ],
  },
  // ── Broader coverage cases ──────────────────────────────────────────
  {
    id: "wikipedia_table_extract",
    query:
      "Go to https://en.wikipedia.org/wiki/List_of_programming_languages and return the first 5 programming languages listed that start with the letter A, as a numbered list.",
    expectedPwOnly: true,
    validate: (result) => {
      const errors = validatePwOnlyUsage(result, true);
      const numbered = result.text.split("\n").filter((line) =>
        /^\d+\.\s+\S/.test(line.trim())
      );
      if (numbered.length < 5) {
        errors.push(`Expected 5 numbered items, got ${numbered.length}.`);
      }
      return errors;
    },
  },
  {
    id: "github_repo_stars",
    query:
      "Go to https://github.com/denoland/deno and answer with exactly two lines: Stars: <star count> and Language: <primary language>.",
    expectedPwOnly: true,
    validate: (result) => {
      const errors = validatePwOnlyUsage(result, true);
      if (!/(?:^#{1,3}\s*)?(?:\*{0,2})Stars:?(?:\*{0,2})\s*[\d,.]+/im.test(result.text)) {
        errors.push("Missing star count.");
      }
      if (!/(?:^#{1,3}\s*)?(?:\*{0,2})Language:?(?:\*{0,2})\s*\S+/im.test(result.text)) {
        errors.push("Missing primary language.");
      }
      return errors;
    },
  },
  {
    id: "npm_package_info",
    query:
      "Go to https://www.npmjs.com/package/express and answer with exactly two lines: Version: <latest version> and Weekly Downloads: <download count>. If the site blocks automated access, state the exact blocker.",
    expectedPwOnly: true,
    validate: (result) => {
      const errors = validatePwOnlyUsage(result, true);
      // Cloudflare/bot-protection is an acceptable blocker for this site
      if (/cloudflare|bot.?protection|captcha|403|security.?challenge/i.test(result.text)) {
        return errors;
      }
      if (!/(?:^#{1,3}\s*)?(?:\*{0,2})Version:?(?:\*{0,2})\s*\d+\.\d+/im.test(result.text)) {
        errors.push("Missing version number.");
      }
      if (!/(?:^#{1,3}\s*)?(?:\*{0,2})Weekly Downloads?:?(?:\*{0,2})\s*[\d,.]+/im.test(result.text)) {
        errors.push("Missing weekly download count.");
      }
      return errors;
    },
  },
  {
    id: "jsonplaceholder_api",
    query:
      "Go to https://jsonplaceholder.typicode.com/todos/1 and return the exact JSON content shown on the page inside a fenced code block.",
    expectedPwOnly: true,
    validate: (result) => {
      const errors = validatePwOnlyUsage(result, true);
      if (!/```[\s\S]{10,}/.test(result.text)) {
        errors.push("Missing fenced code block.");
      }
      if (!result.text.includes('"userId"') || !result.text.includes('"title"')) {
        errors.push("Missing JSON fields userId and title.");
      }
      return errors;
    },
  },
  {
    id: "scroll_and_extract",
    query:
      "Go to https://en.wikipedia.org/wiki/TypeScript and answer with exactly: Created by: <creator> and First appeared: <year>.",
    expectedPwOnly: true,
    validate: (result) => {
      const errors = validatePwOnlyUsage(result, true);
      if (!/(?:Created by|Developer):?\s*\S+/i.test(result.text)) {
        errors.push("Missing creator info.");
      }
      if (!/(?:First appeared|Year):?.*\d{4}/i.test(result.text)) {
        errors.push("Missing first appeared year.");
      }
      return errors;
    },
  },
  {
    id: "multi_page_navigation",
    query:
      "Go to https://docs.deno.com/, find the link to the Runtime section, navigate to it, and answer with: Title: <page title> and First heading: <first h2 or h3 heading on the page>.",
    expectedPwOnly: true,
    validate: (result) => {
      const errors = validatePwOnlyUsage(result, true);
      if (!hasSectionWithContent(result.text, "Title", 3)) {
        errors.push("Missing page title.");
      }
      if (!hasSectionWithContent(result.text, "First heading", 3) &&
          !/heading:?\s*\S+/i.test(result.text)) {
        errors.push("Missing first heading.");
      }
      return errors;
    },
  },
  // ── Edge cases: SPA, redirects, dynamic content, select/dropdown ───
  {
    id: "spa_react_app",
    query:
      "Go to https://react.dev/learn and answer with: Title: <page title> and First section: <the first section heading on the page>.",
    expectedPwOnly: true,
    validate: (result) => {
      const errors = validatePwOnlyUsage(result, true);
      if (!/title:?.*\S{3,}/i.test(result.plain)) {
        errors.push("Missing page title.");
      }
      if (!/(?:first )?section:?.*\S{3,}/i.test(result.plain)) {
        errors.push("Missing first section heading.");
      }
      return errors;
    },
  },
  {
    id: "redirect_follow",
    query:
      "Go to https://github.com/denoland/deno/releases/latest and answer with: Tag: <release tag> and Title: <release title>.",
    expectedPwOnly: true,
    validate: (result) => {
      const errors = validatePwOnlyUsage(result, true);
      if (!/tag:?.*v?\d+\.\d+/i.test(result.plain)) {
        errors.push("Missing release tag with version number.");
      }
      if (!/title:?.*\S{3,}/i.test(result.plain)) {
        errors.push("Missing release title.");
      }
      return errors;
    },
  },
  {
    id: "anchor_hash_navigation",
    query:
      "Go to https://en.wikipedia.org/wiki/Rust_(programming_language)#Syntax and answer with: Section: <the heading at that anchor> and First sentence: <the first sentence of that section>.",
    expectedPwOnly: true,
    validate: (result) => {
      const errors = validatePwOnlyUsage(result, true);
      if (!/section:?.*\S{3,}/i.test(result.plain)) {
        errors.push("Missing section heading.");
      }
      if (!/(?:first )?sentence:?.{10,}/i.test(result.plain)) {
        errors.push("Missing first sentence.");
      }
      return errors;
    },
  },
  {
    id: "dynamic_js_content",
    query:
      "Go to https://api.github.com/repos/denoland/deno and answer with: Stars: <stargazers_count> and Forks: <forks_count>.",
    expectedPwOnly: true,
    validate: (result) => {
      const errors = validatePwOnlyUsage(result, true);
      if (!/stars:?.*\d+/i.test(result.plain)) {
        errors.push("Missing star count.");
      }
      if (!/forks:?.*\d+/i.test(result.plain)) {
        errors.push("Missing fork count.");
      }
      return errors;
    },
  },
  {
    id: "select_dropdown_interaction",
    query:
      "Go to https://httpbin.org/forms/post, select 'medium' for the pizza size (it is a dropdown/select), fill name as 'Test', then submit. Return the echoed size value.",
    expectedPwOnly: true,
    validate: (result) => {
      const errors = validatePwOnlyUsage(result, true);
      if (!/medium/i.test(result.text)) {
        errors.push("Missing echoed 'medium' size value.");
      }
      return errors;
    },
  },
  {
    id: "large_table_pagination",
    query:
      "Go to https://en.wikipedia.org/wiki/List_of_countries_by_population_(United_Nations) and answer with: First: <first country name> and Population: <its population number>.",
    expectedPwOnly: true,
    validate: (result) => {
      const errors = validatePwOnlyUsage(result, true);
      if (!/first:?.*\S{3,}/i.test(result.plain)) {
        errors.push("Missing first country name.");
      }
      if (!/population:?.*[\d,]+/i.test(result.plain)) {
        errors.push("Missing population number.");
      }
      return errors;
    },
  },
  {
    id: "cookie_banner_site",
    query:
      "Go to https://stackoverflow.com/questions/tagged/typescript and answer with: Top question: <title of the first question> and Votes: <its vote count>. If the site blocks automated access, state the exact blocker.",
    expectedPwOnly: true,
    validate: (result) => {
      const errors = validatePwOnlyUsage(result, true);
      if (/cloudflare|turnstile|bot.?protection|captcha|403|security.?challenge/i.test(result.text)) {
        return errors;
      }
      if (!/(?:top )?question:?.*\S{5,}/i.test(result.plain)) {
        errors.push("Missing top question title.");
      }
      if (!/votes:?.*\d+/i.test(result.plain)) {
        errors.push("Missing vote count.");
      }
      return errors;
    },
  },
  // ── Harder edge cases: multi-step, scroll-dependent, search→click→read ──
  {
    id: "search_then_click_result",
    query:
      "Go to https://en.wikipedia.org/wiki/Main_Page, use the search box to search for 'WebAssembly', click on the first result, and answer with: First sentence: <the first sentence of the article>.",
    expectedPwOnly: true,
    validate: (result) => {
      const errors = validatePwOnlyUsage(result, true);
      if (!/(?:first )?sentence:?.{20,}/i.test(result.plain)) {
        errors.push("Missing first sentence (needs 20+ chars).");
      }
      if (!/wasm|webassembly|binary/i.test(result.text)) {
        errors.push("Response doesn't mention WebAssembly-related content.");
      }
      return errors;
    },
  },
  {
    id: "scroll_to_bottom_extract",
    query:
      "Go to https://en.wikipedia.org/wiki/Node.js, scroll to the References section at the bottom, and answer with: Reference count: <approximate number of references> and Last reference: <text of the last reference>.",
    expectedPwOnly: true,
    validate: (result) => {
      const errors = validatePwOnlyUsage(result, true);
      if (!/(?:reference )?count:?.*\d+/i.test(result.plain)) {
        errors.push("Missing reference count.");
      }
      if (!/(?:last )?reference:?.*\S{5,}/i.test(result.plain)) {
        errors.push("Missing last reference text.");
      }
      return errors;
    },
  },
  {
    id: "multi_click_workflow",
    query:
      "Go to https://github.com/denoland/deno, click on the 'Issues' tab, then click on the 'Labels' link, and answer with: Label count: <number of labels shown>.",
    expectedPwOnly: true,
    validate: (result) => {
      const errors = validatePwOnlyUsage(result, true);
      if (!/(?:label )?count:?.*\d+/i.test(result.plain)) {
        errors.push("Missing label count.");
      }
      return errors;
    },
  },
  {
    id: "download_with_navigation",
    query:
      "Go to https://go.dev/dl/ and download the latest stable macOS ARM64 pkg installer. Answer with exactly two lines: Filename: <name> and Saved to: <absolute path>.",
    expectedPwOnly: true,
    validate: async (result) => [
      ...validatePwOnlyUsage(result, true),
      ...await validateDownloadResponse(result, [".pkg"]),
    ],
  },
  {
    id: "extract_nested_content",
    query:
      "Go to https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Promise and answer with: Constructor: <the Promise constructor signature> and First static method: <name of the first static method listed>.",
    expectedPwOnly: true,
    validate: (result) => {
      const errors = validatePwOnlyUsage(result, true);
      if (!/constructor:?.*promise/i.test(result.plain)) {
        errors.push("Missing Promise constructor.");
      }
      if (!/(?:first )?static method:?.*\S{3,}/i.test(result.plain)) {
        errors.push("Missing first static method name.");
      }
      return errors;
    },
  },
  {
    id: "compare_two_pages",
    query:
      "Go to https://github.com/denoland/deno and note the star count, then go to https://github.com/nodejs/node and note the star count. Answer with: Deno stars: <count> and Node stars: <count>.",
    expectedPwOnly: true,
    validate: (result) => {
      const errors = validatePwOnlyUsage(result, true);
      if (!/deno.*stars?:?.*[\d,.]+/i.test(result.plain)) {
        errors.push("Missing Deno star count.");
      }
      if (!/node.*stars?:?.*[\d,.]+/i.test(result.plain)) {
        errors.push("Missing Node star count.");
      }
      return errors;
    },
  },
  {
    id: "slow_loading_spa",
    query:
      "Go to https://vite.dev/ and answer with: Tagline: <the main tagline/slogan on the hero section> and Get Started link: <the URL the Get Started button points to>.",
    expectedPwOnly: true,
    validate: (result) => {
      const errors = validatePwOnlyUsage(result, true);
      if (!/tagline:?.*\S{5,}/i.test(result.plain)) {
        errors.push("Missing tagline.");
      }
      if (!/(?:get started|link):?.*https?:\/\//i.test(result.plain) &&
          !/(?:get started|link):?.*\//i.test(result.plain)) {
        errors.push("Missing Get Started link URL.");
      }
      return errors;
    },
  },
  // ── Stress tests: multi-download, back-navigation, deep scroll, iframe ──
  {
    id: "multiple_downloads",
    query:
      "Go to https://go.dev/dl/ and download both the latest stable macOS ARM64 pkg installer AND the latest stable Linux AMD64 tar.gz. Answer with the two filenames and saved paths.",
    expectedPwOnly: true,
    validate: async (result) => {
      const errors = validatePwOnlyUsage(result, true);
      const pkgPattern = /\.pkg\b/i;
      const tgzPattern = /\.tar\.gz\b/i;
      if (!pkgPattern.test(result.text)) errors.push("Missing .pkg download.");
      if (!tgzPattern.test(result.text)) errors.push("Missing .tar.gz download.");
      // Check that both absolute paths appear somewhere in the response
      const absolutePaths = result.text.match(/(?:\/[\w.-]+){2,}/g) ?? [];
      if (absolutePaths.length < 2) errors.push(`Expected 2 file paths, got ${absolutePaths.length}.`);
      return errors;
    },
  },
  {
    id: "deep_nested_navigation",
    query:
      "Go to https://docs.python.org/3/, navigate to Library Reference, then navigate to Built-in Functions, and answer with: Page title: <title> and First function: <name of the first function listed>.",
    expectedPwOnly: true,
    validate: (result) => {
      const errors = validatePwOnlyUsage(result, true);
      if (!/(?:page )?title:?.{3,}/i.test(result.plain)) errors.push("Missing page title.");
      if (!/(?:first )?function:?.{2,}/i.test(result.plain)) errors.push("Missing first function name.");
      return errors;
    },
  },
  {
    id: "extract_from_code_block_page",
    query:
      "Go to https://deno.com/blog and find the most recent blog post. Navigate to it and answer with: Title: <post title> and Date: <publish date>.",
    expectedPwOnly: true,
    validate: (result) => {
      const errors = validatePwOnlyUsage(result, true);
      if (!/title:?.{5,}/i.test(result.plain)) errors.push("Missing post title.");
      if (!/date:?.*\d{4}/i.test(result.plain)) errors.push("Missing publish date with year.");
      return errors;
    },
  },
  {
    id: "github_file_content",
    query:
      "Go to https://github.com/denoland/deno/blob/main/LICENSE.md and answer with: License type: <the license name> and First line: <the first non-empty line of the license text>.",
    expectedPwOnly: true,
    validate: (result) => {
      const errors = validatePwOnlyUsage(result, true);
      if (!/license.*type:?.{3,}/i.test(result.plain) && !/MIT|Apache|BSD|ISC/i.test(result.text)) {
        errors.push("Missing license type.");
      }
      if (!/first.*line:?.{10,}/i.test(result.plain) && !/copyright|permission|license/i.test(result.text)) {
        errors.push("Missing first line of license.");
      }
      return errors;
    },
  },
  {
    id: "pagination_next_page",
    query:
      "Go to https://github.com/denoland/deno/issues, go to page 2 of the issues list, and answer with: Page: 2 and First issue: <title of the first issue on page 2>.",
    expectedPwOnly: true,
    validate: (result) => {
      const errors = validatePwOnlyUsage(result, true);
      if (!/page:?\s*2/i.test(result.plain)) errors.push("Missing page 2 confirmation.");
      if (!/(?:first )?issue:?.{5,}/i.test(result.plain)) errors.push("Missing first issue title on page 2.");
      return errors;
    },
  },
  {
    id: "extract_meta_info",
    query:
      "Go to https://github.com/anthropics/anthropic-sdk-python and answer with: Description: <repo description> and License: <license type> and Latest release: <latest release tag or version if visible>.",
    expectedPwOnly: true,
    validate: (result) => {
      const errors = validatePwOnlyUsage(result, true);
      if (!/description:?.{10,}/i.test(result.plain)) errors.push("Missing repo description.");
      if (!/license:?.{2,}/i.test(result.plain)) errors.push("Missing license info.");
      return errors;
    },
  },
];

const ACTIVE_CASES = CASE_FILTER
  ? CASES.filter((c) =>
    CASE_FILTER.split(",").map((s) => s.trim()).includes(c.id)
  )
  : CASES;

Deno.test({
  name:
    "E2E exploratory: real-world browser suite is graded semantically instead of by stream completion",
  ignore: !ENABLED,
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
    const failures: string[] = [];

    try {
      await withTemporaryWorkspace(async (workspace) => {
        for (const testCase of ACTIVE_CASES) {
          const events: AgentUIEvent[] = [];
          let caseModel = "(none)";
          try {
            const { model, result } = await runSourceAgentWithCompatibleModel({
              models: MODEL_CANDIDATES,
              query: testCase.query,
              workspace,
              signal: controller.signal,
              disablePersistentMemory: true,
              permissionMode: "bypassPermissions",
              maxTokens: 2_400,
              callbacks: {
                onAgentEvent: (event) => events.push(event),
              },
            });
            caseModel = model;

            const toolNames = collectToolNames(events);
            const trimmedText = result.text.trim();
            const semanticResult: BrowserSemanticResult = {
              text: trimmedText,
              plain: stripMarkdown(trimmedText),
              toolNames,
              usedCu: toolNames.some((name) => name.startsWith("cu_")),
              usedPwPromote: toolNames.includes("pw_promote"),
            };
            const errors = await testCase.validate(semanticResult);
            if (errors.length > 0) {
              failures.push(
                [
                  `FAIL ${testCase.id}`,
                  `  Model: ${caseModel}`,
                  `  Tools: ${toolNames.join(", ") || "(none)"}`,
                  `  Response: ${semanticResult.text.slice(0, 300)}`,
                  `  Errors: ${errors.join(" | ")}`,
                ].join("\n"),
              );
            } else {
              console.log(
                `PASS ${testCase.id} | Model: ${caseModel} | Tools: ${toolNames.join(", ") || "(none)"}`,
              );
            }
          } catch (error) {
            failures.push(
              `CRASH ${testCase.id} | Model: ${caseModel} | ${error instanceof Error ? error.message : String(error)}`,
            );
          }
        }
      });
    } finally {
      clearTimeout(timeout);
    }

    assertEquals(
      failures,
      [],
      `\n${failures.length} of ${ACTIVE_CASES.length} case(s) failed:\n${failures.join("\n\n")}`,
    );
  },
});
