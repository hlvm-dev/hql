/**
 * Opt-in productivity MCP evaluation using a fake fixture server.
 *
 * Purpose:
 * - Validate that HLVM can compose local file reading with productivity-style MCP actions
 * - Keep the workflow test-only: no real Gmail, calendar, or reminders side effects
 * - Grade by tool selection, not just final text output
 *
 * Run:
 *   HLVM_E2E_PRODUCTIVITY_MCP=1 \
 *   HLVM_LIVE_AGENT_MODEL=google/gemini-2.5-flash \
 *   deno test --allow-all tests/e2e/productivity-mcp-eval.test.ts
 *
 * Single case:
 *   HLVM_E2E_PRODUCTIVITY_MCP=1 \
 *   HLVM_E2E_PRODUCTIVITY_CASE=draft_follow_up_email \
 *   deno test --allow-all tests/e2e/productivity-mcp-eval.test.ts
 */

import { assertEquals } from "jsr:@std/assert";
import type { AgentUIEvent } from "../../src/hlvm/agent/orchestrator.ts";
import { getPlatform } from "../../src/platform/platform.ts";
import { fixtureServer, writeMcpConfig } from "./mcp-fixture-helpers.ts";
import {
  runSourceAgentWithCompatibleModel,
  withFullyIsolatedEnv,
} from "./native-provider-smoke-helpers.ts";

const platform = getPlatform();
const ENABLED = platform.env.get("HLVM_E2E_PRODUCTIVITY_MCP") === "1";
const CASE_FILTER = platform.env.get("HLVM_E2E_PRODUCTIVITY_CASE")?.trim() ??
  "";
const TIMEOUT_MS = 240_000;

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

interface ProductivityCase {
  id: string;
  description: string;
  query: string;
  fixtures: Record<string, string>;
  toolAllowlist: string[];
  validate: (result: ProductivityResult) => string[];
}

interface ProductivityResult {
  text: string;
  toolNames: string[];
  toolArgs: Array<{ name: string; args: string }>;
}

function renderWorkspaceScopedQuery(query: string, workspace: string): string {
  return [
    query,
    "",
    `Current workspace: ${workspace}`,
    "Use the current workspace for local files mentioned in this request.",
    "Use the available productivity MCP tools for drafts, calendar events, or reminders instead of shell_exec.",
    "This is a test-only environment. Do not send anything or access any real account.",
  ].join("\n");
}

function collectToolInfo(events: AgentUIEvent[]): ProductivityResult {
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
  result: ProductivityResult,
  expectedTools: string[],
): string[] {
  return expectedTools
    .filter((tool) => !result.toolNames.includes(tool))
    .map((tool) => `Expected tool '${tool}' to be used but it was not.`);
}

function expectToolsNotUsed(
  result: ProductivityResult,
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

function expectTextContains(text: string, substrings: string[]): string[] {
  const lower = text.toLowerCase();
  return substrings
    .filter((s) => !lower.includes(s.toLowerCase()))
    .map((s) => `Expected response to contain '${s}' but it did not.`);
}

const CASES: ProductivityCase[] = [
  {
    id: "draft_follow_up_email",
    description:
      "Agent should read a local summary file and create a draft email through the fake MCP tool, not shell_exec",
    query:
      "Read followup.txt and draft an email to alex@example.com with subject 'Follow-up from the meeting'. Summarize the action items clearly, but do not send anything.",
    fixtures: {
      "followup.txt":
        "- Ship the beta build by Friday.\n- Send the updated onboarding doc.\n- Confirm the review meeting next Tuesday.\n",
    },
    toolAllowlist: [
      "read_file",
      "tool_search",
      "mcp_productivity_gmail_create_draft",
      "shell_exec",
      "ask_user",
    ],
    validate: (result) => [
      ...expectToolsUsed(result, [
        "read_file",
        "mcp_productivity_gmail_create_draft",
      ]),
      ...expectToolsNotUsed(result, ["shell_exec"]),
      ...expectTextContains(result.text, [
        "draft",
        "alex@example.com",
        "Follow-up from the meeting",
      ]),
    ],
  },
  {
    id: "schedule_review_event",
    description:
      "Agent should read a local agenda file and create a calendar event through the fake MCP tool, not shell_exec",
    query:
      "Read review-plan.txt and create a calendar event titled 'Design Review' for April 14, 2026 from 3:00 PM to 3:45 PM Asia/Seoul with attendees mina@example.com and joon@example.com. Include the agenda from the file.",
    fixtures: {
      "review-plan.txt":
        "Agenda:\n1. Review the updated navigation flow.\n2. Decide on the launch checklist.\n3. Confirm final QA owner.\n",
    },
    toolAllowlist: [
      "read_file",
      "tool_search",
      "mcp_productivity_calendar_create_event",
      "shell_exec",
      "ask_user",
    ],
    validate: (result) => [
      ...expectToolsUsed(result, [
        "read_file",
        "mcp_productivity_calendar_create_event",
      ]),
      ...expectToolsNotUsed(result, ["shell_exec"]),
      ...expectTextContains(result.text, [
        "Design Review",
        "April 14, 2026",
        "mina@example.com",
      ]),
    ],
  },
  {
    id: "create_follow_up_reminder",
    description:
      "Agent should read a local note and create a reminder through the fake MCP tool, not shell_exec",
    query:
      "Read followup.txt and create a reminder titled 'Check Alex reply' due April 17, 2026 at 5:00 PM Asia/Seoul. Use the file contents as reminder notes.",
    fixtures: {
      "followup.txt":
        "Follow up on the beta build status and confirm whether the onboarding document was reviewed.\n",
    },
    toolAllowlist: [
      "read_file",
      "tool_search",
      "mcp_productivity_reminders_create_item",
      "shell_exec",
      "ask_user",
    ],
    validate: (result) => [
      ...expectToolsUsed(result, [
        "read_file",
        "mcp_productivity_reminders_create_item",
      ]),
      ...expectToolsNotUsed(result, ["shell_exec"]),
      ...expectTextContains(result.text, [
        "Check Alex reply",
        "April 17, 2026",
      ]),
    ],
  },
  {
    id: "draft_email_and_reminder",
    description:
      "Agent should compose a follow-up draft and reminder from the same local note using two fake MCP tools",
    query:
      "Read followup.txt. Draft an email to alex@example.com with subject 'Beta follow-up'. Also create a reminder titled 'Check beta reply' due April 18, 2026 at 9:00 AM Asia/Seoul. Do not send anything.",
    fixtures: {
      "followup.txt":
        "Ask whether the beta build is approved and whether the onboarding document needs another revision.\n",
    },
    toolAllowlist: [
      "read_file",
      "tool_search",
      "mcp_productivity_gmail_create_draft",
      "mcp_productivity_reminders_create_item",
      "shell_exec",
      "ask_user",
    ],
    validate: (result) => [
      ...expectToolsUsed(result, [
        "read_file",
        "mcp_productivity_gmail_create_draft",
        "mcp_productivity_reminders_create_item",
      ]),
      ...expectToolsNotUsed(result, ["shell_exec"]),
      ...expectTextContains(result.text, [
        "alex@example.com",
        "Beta follow-up",
        "Check beta reply",
      ]),
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
    "E2E eval: productivity MCP tasks graded by tool selection and answer quality",
  ignore: !ENABLED,
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
    const failures: string[] = [];

    try {
      await withFullyIsolatedEnv(async (workspace) => {
        await writeMcpConfig([
          fixtureServer("productivity", {
            allowEnv: ["MCP_TEST_MODE"],
            env: { MCP_TEST_MODE: "productivity_tools" },
          }),
        ]);

        for (const testCase of ACTIVE_CASES) {
          for (const [name, content] of Object.entries(testCase.fixtures)) {
            const filePath = platform.path.join(workspace, name);
            await platform.fs.mkdir(platform.path.dirname(filePath), {
              recursive: true,
            });
            await platform.fs.writeTextFile(filePath, content);
          }

          const events: AgentUIEvent[] = [];
          let caseModel = "(none)";

          try {
            const { model, result } = await runSourceAgentWithCompatibleModel(
              {
                models: MODEL_CANDIDATES,
                query: renderWorkspaceScopedQuery(testCase.query, workspace),
                workspace,
                signal: controller.signal,
                disablePersistentMemory: true,
                permissionMode: "bypassPermissions",
                toolAllowlist: testCase.toolAllowlist,
                maxTokens: 2_000,
                callbacks: {
                  onAgentEvent: (event) => events.push(event),
                },
              },
            );
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
                `  Response (first 240): ${result.text.slice(0, 240)}`,
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

          try {
            for await (const entry of platform.fs.readDir(workspace)) {
              await platform.fs.remove(
                platform.path.join(workspace, entry.name),
                { recursive: true },
              );
            }
          } catch {
            // Best-effort cleanup only.
          }
        }
      });
    } finally {
      clearTimeout(timeout);
    }

    assertEquals(
      failures,
      [],
      `Productivity MCP eval failures:\n${failures.join("\n\n")}`,
    );
  },
});
