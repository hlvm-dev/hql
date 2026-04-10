/**
 * Opt-in app/system workflow evaluation.
 *
 * Purpose:
 * - Validate that HLVM handles app/system tasks as first-class local work
 * - Verify the binary prefers semantic app/system tools over shell commands
 * - Grade by tool selection, not just final text output
 *
 * Run:
 *   HLVM_E2E_SYSTEM_WORKFLOW=1 \
 *   HLVM_LIVE_AGENT_MODEL=google/gemini-2.5-flash \
 *   deno test --allow-all tests/e2e/system-workflow-eval.test.ts
 *
 * Single case:
 *   HLVM_E2E_SYSTEM_WORKFLOW=1 \
 *   HLVM_E2E_SYSTEM_CASE=list_accessible_apps \
 *   deno test --allow-all tests/e2e/system-workflow-eval.test.ts
 */

import { assertEquals } from "jsr:@std/assert";
import type { AgentUIEvent } from "../../src/hlvm/agent/orchestrator.ts";
import { getPlatform } from "../../src/platform/platform.ts";
import {
  runSourceAgentWithCompatibleModel,
  withFullyIsolatedEnv,
} from "./native-provider-smoke-helpers.ts";

const platform = getPlatform();
const ENABLED = platform.env.get("HLVM_E2E_SYSTEM_WORKFLOW") === "1";
const CASE_FILTER = platform.env.get("HLVM_E2E_SYSTEM_CASE")?.trim() ?? "";
const TIMEOUT_MS = 180_000;

const DEFAULT_MODEL_CANDIDATES = [
  "claude-code/claude-haiku-4-5-20251001",
  "claude-code/claude-haiku-4-5-20251001:agent",
  "claude-haiku-4.5",
  "claude-haiku-4-5-20251001",
  "claude-haiku-4-5-20251001:agent",
  "google/gemini-2.5-flash",
  "google/gemini-2.5-flash-lite",
  "google/gemini-2.0-flash-001",
] as const;
const liveModel = platform.env.get("HLVM_LIVE_AGENT_MODEL")?.trim() ?? "";
const MODEL_CANDIDATES = [
  ...new Set(
    [liveModel, ...DEFAULT_MODEL_CANDIDATES].filter((v) => v.length > 0),
  ),
];

interface SystemWorkflowCase {
  id: string;
  description: string;
  query: string;
  toolAllowlist?: string[];
  validate: (result: SystemWorkflowResult) => string[];
}

interface SystemWorkflowResult {
  text: string;
  toolNames: string[];
  toolArgs: Array<{ name: string; args: string }>;
}

function renderWorkspaceScopedQuery(query: string, workspace: string): string {
  return [
    query,
    "",
    `Current workspace: ${workspace}`,
    "Use the current workspace when a folder location is needed.",
    "Prefer the dedicated semantic app/system tool over shell_exec when one exists.",
  ].join("\n");
}

function collectToolInfo(events: AgentUIEvent[]): SystemWorkflowResult {
  const toolNames: string[] = [];
  const toolArgs: Array<{ name: string; args: string }> = [];
  for (const event of events) {
    if (event.type === "tool_end") {
      toolNames.push(event.name);
    }
    if (event.type === "tool_start") {
      toolArgs.push({ name: event.name, args: event.argsSummary ?? "" });
    }
  }
  return { text: "", toolNames, toolArgs };
}

function expectToolsUsed(
  result: SystemWorkflowResult,
  expectedTools: string[],
): string[] {
  return expectedTools
    .filter((tool) => !result.toolNames.includes(tool))
    .map((tool) => `Expected tool '${tool}' to be used but it was not.`);
}

function expectToolsNotUsed(
  result: SystemWorkflowResult,
  forbiddenTools: string[],
): string[] {
  return forbiddenTools
    .filter((tool) => result.toolNames.includes(tool))
    .map((tool) =>
      `Tool '${tool}' was used but should not have been. Tools used: ${
        result.toolNames.join(", ")
      }`
    );
}

function expectNoShellFor(
  result: SystemWorkflowResult,
  shellPatterns: RegExp[],
): string[] {
  const errors: string[] = [];
  for (const entry of result.toolArgs) {
    if (entry.name !== "shell_exec") continue;
    for (const pattern of shellPatterns) {
      if (pattern.test(entry.args)) {
        errors.push(
          `shell_exec was used with '${entry.args}' — a dedicated tool should handle this instead.`,
        );
      }
    }
  }
  return errors;
}

function expectTextContains(text: string, substrings: string[]): string[] {
  const lower = text.toLowerCase();
  return substrings
    .filter((s) => !lower.includes(s.toLowerCase()))
    .map((s) => `Expected response to contain '${s}' but it did not.`);
}

function expectMinLength(text: string, minLength: number): string[] {
  if (text.trim().length < minLength) {
    return [
      `Expected response of at least ${minLength} chars, got ${text.trim().length}.`,
    ];
  }
  return [];
}

const CASES: SystemWorkflowCase[] = [
  {
    id: "list_accessible_apps",
    description:
      "Agent should use cu_list_granted_applications to inspect running apps, not shell process listing",
    query:
      "List the applications that are currently running and accessible right now.",
    toolAllowlist: [
      "cu_list_granted_applications",
      "shell_exec",
      "ask_user",
    ],
    validate: (result) => [
      ...expectToolsUsed(result, ["cu_list_granted_applications"]),
      ...expectNoShellFor(result, [/ps\b/i, /osascript\b/i, /pgrep\b/i]),
      ...expectMinLength(result.text, 10),
    ],
  },
  {
    id: "open_finder_application",
    description:
      "Agent should use cu_open_application to open Finder by bundle ID, not shell open/osascript",
    query: "Open the Finder application using the bundle ID com.apple.finder.",
    toolAllowlist: [
      "cu_open_application",
      "shell_exec",
      "ask_user",
    ],
    validate: (result) => [
      ...expectToolsUsed(result, ["cu_open_application"]),
      ...expectNoShellFor(result, [/^open\b/i, /osascript\b/i]),
      ...expectTextContains(result.text, ["Finder"]),
    ],
  },
  {
    id: "open_workspace_folder",
    description:
      "Agent should use open_path to hand off the current workspace folder to the default file manager",
    query: "Open the current workspace folder with the default application.",
    toolAllowlist: [
      "open_path",
      "shell_exec",
      "ask_user",
    ],
    validate: (result) => [
      ...expectToolsUsed(result, ["open_path"]),
      ...expectNoShellFor(result, [/^open\b/i, /explorer\.exe/i]),
      ...expectMinLength(result.text, 5),
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
    "E2E eval: app/system workflow tasks graded by tool selection and answer quality",
  ignore: !ENABLED,
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    if (platform.build.os !== "darwin") return;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
    const failures: string[] = [];

    try {
      await withFullyIsolatedEnv(async (workspace) => {
        for (const testCase of ACTIVE_CASES) {
          const events: AgentUIEvent[] = [];
          let caseModel = "(none)";

          try {
            const { model, result } = await runSourceAgentWithCompatibleModel({
              models: MODEL_CANDIDATES,
              query: renderWorkspaceScopedQuery(testCase.query, workspace),
              workspace,
              signal: controller.signal,
              disablePersistentMemory: true,
              permissionMode: "bypassPermissions",
              toolAllowlist: testCase.toolAllowlist,
              maxTokens: 1_500,
              callbacks: {
                onAgentEvent: (event) => events.push(event),
              },
            });
            caseModel = model;

            const semanticResult = collectToolInfo(events);
            semanticResult.text = result.text.trim();

            const errors = testCase.validate(semanticResult);
            if (errors.length > 0) {
              const detail = [
                `  Case: ${testCase.id} (${testCase.description})`,
                `  Model: ${caseModel}`,
                `  Tools used: ${
                  semanticResult.toolNames.join(", ") || "(none)"
                }`,
                `  Response (first 200): ${result.text.slice(0, 200)}`,
                ...errors.map((err) => `  FAIL: ${err}`),
              ].join("\n");
              failures.push(detail);
            }
          } catch (error) {
            failures.push(
              `  Case: ${testCase.id} — ERROR: ${
                error instanceof Error ? error.message : String(error)
              }`,
            );
          }
        }
      });
    } finally {
      clearTimeout(timeout);
    }

    if (failures.length > 0) {
      const report = [
        `\n${"=".repeat(60)}`,
        `SYSTEM WORKFLOW EVAL: ${failures.length}/${ACTIVE_CASES.length} cases failed`,
        `${"=".repeat(60)}`,
        ...failures,
        `${"=".repeat(60)}`,
      ].join("\n");
      console.error(report);
    }

    assertEquals(
      failures.length,
      0,
      `${failures.length}/${ACTIVE_CASES.length} system workflow eval cases failed. See output above.`,
    );
  },
});
