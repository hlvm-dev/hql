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
  toolNames: string[];
  usedCu: boolean;
  usedPwPromote: boolean;
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
            const semanticResult: BrowserSemanticResult = {
              text: result.text.trim(),
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
