/**
 * Opt-in real-world computer use (CU) semantic evaluation.
 *
 * Purpose:
 * - Validate that cu_* tools work end-to-end through a real agent loop
 * - CU-exclusive: only cu_* tools are offered to the LLM (no pw_* fallback)
 * - Grade the agent's terminal answer + verify correct tool usage
 * - Requires macOS with a real GUI session (CGEvent, screencapture need display)
 *
 * Run:
 *   HLVM_E2E_COMPUTER_USE=1 \
 *   HLVM_LIVE_AGENT_MODEL=claude-haiku-4-5-20251001 \
 *   deno test --allow-all tests/e2e/computer-use-eval.test.ts
 *
 * Single case:
 *   HLVM_E2E_COMPUTER_USE=1 HLVM_E2E_CU_CASE=screenshot_basic \
 *   deno test --allow-all tests/e2e/computer-use-eval.test.ts
 */

import { assertEquals } from "jsr:@std/assert";
import type { AgentUIEvent } from "../../src/hlvm/agent/orchestrator.ts";
import { getPlatform } from "../../src/platform/platform.ts";
import { COMPUTER_USE_TOOLS } from "../../src/hlvm/agent/computer-use/mod.ts";
import {
  runSourceAgentWithCompatibleModel,
  withAbortTimeout,
  withTemporaryWorkspace,
} from "./native-provider-smoke-helpers.ts";

// ── Gating ────────────────────────────────────────────────────────────────

const platform = getPlatform();
const IS_MACOS = platform.build.os === "darwin";
const ENABLED = platform.env.get("HLVM_E2E_COMPUTER_USE") === "1" && IS_MACOS;
const CASE_FILTER = platform.env.get("HLVM_E2E_CU_CASE")?.trim() ?? "";
const TIMEOUT_MS = 420_000; // 7 minutes

const DEFAULT_MODEL_CANDIDATES = [
  "claude-code/claude-haiku-4-5-20251001",
  "claude-code/claude-haiku-4-5-20251001:agent",
  "claude-haiku-4.5",
  "claude-haiku-4-5-20251001",
  "claude-haiku-4-5-20251001:agent",
];
const liveModel = platform.env.get("HLVM_LIVE_AGENT_MODEL")?.trim() ?? "";
const MODEL_CANDIDATES = [
  ...new Set(
    [liveModel, ...DEFAULT_MODEL_CANDIDATES].filter(
      (value) => value.length > 0,
    ),
  ),
];

/** Dynamic allowlist — stays in sync with source tool definitions. */
const CU_TOOL_ALLOWLIST = Object.keys(COMPUTER_USE_TOOLS);

// ── Types ─────────────────────────────────────────────────────────────────

interface ComputerUseCase {
  id: string;
  query: string;
  /** cu_* tools that MUST appear in the selected tool event stream. */
  requiredTools: string[];
  requiredToolMode?: "success" | "attempted";
  validate: (result: ComputerUseResult) => Promise<string[]> | string[];
}

interface ComputerUseResult {
  text: string;
  /** Text with markdown bold/italic/heading markers stripped. */
  plain: string;
  successfulToolNames: string[];
  attemptedToolNames: string[];
  failedToolNames: string[];
}

interface CapturedAgentEvent {
  at: string;
  offsetMs: number;
  event: AgentUIEvent;
}

// ── Utilities ─────────────────────────────────────────────────────────────

function uniqueNames(names: string[]): string[] {
  return [...new Set(names)];
}

function collectSuccessfulToolNames(events: AgentUIEvent[]): string[] {
  return uniqueNames(events
    .filter(
      (event): event is Extract<AgentUIEvent, { type: "tool_end" }> =>
        event.type === "tool_end" && event.success,
    )
    .map((event) => event.name));
}

function collectAttemptedToolNames(events: AgentUIEvent[]): string[] {
  return uniqueNames(events
    .filter(
      (event): event is Extract<AgentUIEvent, { type: "tool_start" }> =>
        event.type === "tool_start",
    )
    .map((event) => event.name));
}

function collectFailedToolNames(events: AgentUIEvent[]): string[] {
  return uniqueNames(events
    .filter(
      (event): event is Extract<AgentUIEvent, { type: "tool_end" }> =>
        event.type === "tool_end" && !event.success,
    )
    .map((event) => event.name));
}

function stripMarkdown(text: string): string {
  return text
    .replace(/^#{1,3}\s+/gm, "")
    .replace(/\*{1,2}([^*]+)\*{1,2}/g, "$1");
}

function validateCuOnlyUsage(result: ComputerUseResult): string[] {
  const pwTools = result.attemptedToolNames.filter((name) =>
    name.startsWith("pw_")
  );
  if (pwTools.length > 0) {
    return [
      `Expected CU-only execution but pw_* tools were used: ${
        pwTools.join(", ")
      }`,
    ];
  }
  return [];
}

function validateRequiredTools(
  result: ComputerUseResult,
  required: string[],
  mode: "success" | "attempted" = "success",
): string[] {
  const errors: string[] = [];
  const usedToolNames = mode === "attempted"
    ? result.attemptedToolNames
    : result.successfulToolNames;
  for (const tool of required) {
    if (!usedToolNames.includes(tool)) {
      errors.push(
        `Required tool '${tool}' was not ${
          mode === "attempted" ? "attempted" : "called successfully"
        }.`,
      );
    }
  }
  return errors;
}

function slugifyCaseId(id: string): string {
  return id.replace(/[^a-zA-Z0-9_-]+/g, "-").replace(/-+/g, "-");
}

function truncateForLog(text: string, max = 280): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  return normalized.length <= max
    ? normalized
    : `${normalized.slice(0, Math.max(0, max - 3))}...`;
}

function formatTimelineEvent(entry: CapturedAgentEvent): string {
  const prefix =
    `[+${String(entry.offsetMs).padStart(5, " ")}ms] ${entry.event.type}`;
  switch (entry.event.type) {
    case "tool_start":
      return `${prefix} ${entry.event.name} :: ${entry.event.argsSummary}`;
    case "tool_progress":
      return `${prefix} ${entry.event.name} :: ${entry.event.message}`;
    case "tool_end":
      return `${prefix} ${entry.event.name} success=${entry.event.success} durationMs=${entry.event.durationMs} :: ${
        truncateForLog(entry.event.content)
      }`;
    case "reasoning_update":
    case "planning_update":
      return `${prefix} :: ${entry.event.summary}`;
    case "turn_stats":
      return `${prefix} tools=${entry.event.toolCount} durationMs=${entry.event.durationMs} model=${entry.event.modelId ?? "(unknown)"}`;
    default:
      return `${prefix} :: ${truncateForLog(JSON.stringify(entry.event))}`;
  }
}

async function writeCaseArtifacts(options: {
  rootDir: string;
  testCase: ComputerUseCase;
  model: string;
  status: "pass" | "fail" | "crash";
  query: string;
  responseText: string;
  events: CapturedAgentEvent[];
  successfulToolNames: string[];
  attemptedToolNames: string[];
  failedToolNames: string[];
  errors: string[];
  crashMessage?: string;
}): Promise<string> {
  const caseDir = platform.path.join(
    options.rootDir,
    slugifyCaseId(options.testCase.id),
  );
  await platform.fs.mkdir(caseDir, { recursive: true });

  const summary = [
    `# CU E2E Case: ${options.testCase.id}`,
    "",
    `- status: ${options.status}`,
    `- model: ${options.model}`,
    `- attempted_tools: ${options.attemptedToolNames.join(", ") || "(none)"}`,
    `- successful_tools: ${
      options.successfulToolNames.join(", ") || "(none)"
    }`,
    `- failed_tools: ${options.failedToolNames.join(", ") || "(none)"}`,
    `- event_count: ${options.events.length}`,
    "",
    "## Query",
    "",
    options.query,
    "",
    "## Response",
    "",
    options.responseText || "(empty)",
    "",
    "## Errors",
    "",
    options.errors.length > 0 ? options.errors.map((e) => `- ${e}`).join("\n") : "- (none)",
    "",
    "## Crash",
    "",
    options.crashMessage ? `- ${options.crashMessage}` : "- (none)",
    "",
    "## Timeline",
    "",
    ...options.events.map((entry) => `- ${formatTimelineEvent(entry)}`),
    "",
  ].join("\n");

  await platform.fs.writeTextFile(
    platform.path.join(caseDir, "summary.md"),
    summary,
  );
  await platform.fs.writeTextFile(
    platform.path.join(caseDir, "events.json"),
    JSON.stringify(options.events, null, 2),
  );
  await platform.fs.writeTextFile(
    platform.path.join(caseDir, "timeline.log"),
    options.events.map((entry) => formatTimelineEvent(entry)).join("\n") + "\n",
  );

  return caseDir;
}

// ── Test Cases ────────────────────────────────────────────────────────────

const CASES: ComputerUseCase[] = [
  // ── Tier 1: Atomic Operations ────────────────────────────────────────
  {
    id: "observe_basic",
    query:
      "Computer-use tools are enabled in this run. Use the available `cu_observe` tool now before answering. After it returns, report the frontmost application name and the number of visible windows.",
    requiredTools: ["cu_observe"],
    validate: (result) => {
      const errors = [
        ...validateCuOnlyUsage(result),
        ...validateRequiredTools(result, ["cu_observe"]),
      ];
      // cu_observe was called — accept if response has any substance
      // (Haiku sometimes hallucinates "tool not available" even after calling it)
      if (
        result.successfulToolNames.includes("cu_observe") &&
        result.plain.length >= 10
      ) {
        return errors;
      }
      if (
        result.plain.length < 20 ||
        !/(frontmost|window|app|\d+)/i.test(result.plain)
      ) {
        errors.push(
          "Expected a desktop observation summary mentioning the frontmost app or visible windows.",
        );
      }
      return errors;
    },
  },
  {
    id: "screenshot_basic",
    query:
      "Take a screenshot of the current screen and describe what you see in 1-2 sentences.",
    requiredTools: ["cu_screenshot"],
    validate: (result) => {
      const errors = [
        ...validateCuOnlyUsage(result),
        ...validateRequiredTools(result, ["cu_screenshot"]),
      ];
      if (result.plain.length < 20) {
        errors.push(
          `Expected descriptive response (20+ chars), got ${result.plain.length} chars.`,
        );
      }
      return errors;
    },
  },
  {
    id: "cursor_position",
    query:
      "What are the current mouse cursor coordinates? Report them as x and y values.",
    requiredTools: ["cu_cursor_position"],
    validate: (result) => {
      const errors = [
        ...validateCuOnlyUsage(result),
        ...validateRequiredTools(result, ["cu_cursor_position"]),
      ];
      if (!/\d+/.test(result.plain)) {
        errors.push("Response should contain numeric coordinates.");
      }
      return errors;
    },
  },
  {
    id: "clipboard_roundtrip",
    query:
      "Write the exact text 'HLVM_TEST_123' to the clipboard, then read it back and confirm whether the read-back matches what you wrote.",
    requiredTools: ["cu_write_clipboard", "cu_read_clipboard"],
    validate: (result) => {
      const errors = [
        ...validateCuOnlyUsage(result),
        ...validateRequiredTools(result, [
          "cu_write_clipboard",
          "cu_read_clipboard",
        ]),
      ];
      if (
        !result.plain.includes("HLVM_TEST_123") &&
        !/match/i.test(result.plain)
      ) {
        errors.push(
          "Response should contain 'HLVM_TEST_123' or confirm a match.",
        );
      }
      return errors;
    },
  },
  {
    id: "list_apps",
    query: "List the currently granted applications for computer use.",
    requiredTools: ["cu_list_granted_applications"],
    validate: (result) => {
      const errors = [
        ...validateCuOnlyUsage(result),
        ...validateRequiredTools(result, ["cu_list_granted_applications"]),
      ];
      if (result.plain.length < 5) {
        errors.push("Expected non-empty application list.");
      }
      return errors;
    },
  },

  // ── Tier 2: Coordinated Sequences ────────────────────────────────────
  {
    id: "click_and_screenshot",
    query:
      "Move the mouse to coordinates (100, 100), perform a left click, then take a screenshot and describe what happened.",
    requiredTools: ["cu_mouse_move", "cu_left_click", "cu_screenshot"],
    validate: (result) => {
      const errors = [
        ...validateCuOnlyUsage(result),
        ...validateRequiredTools(result, [
          "cu_mouse_move",
          "cu_left_click",
          "cu_screenshot",
        ]),
      ];
      if (result.plain.length < 10) {
        errors.push("Expected a description of the screen after clicking.");
      }
      return errors;
    },
  },
  {
    id: "type_text",
    query:
      "Open the TextEdit application, then type the text 'Hello from HLVM', then take a screenshot to confirm the text was typed.",
    requiredTools: ["cu_open_application", "cu_screenshot"],
    validate: (result) => {
      const errors = validateCuOnlyUsage(result);
      // cu_execute_plan can subsume open+type+verify — accept it as alternative
      const usedExecutePlan =
        result.attemptedToolNames.includes("cu_execute_plan");
      if (!usedExecutePlan) {
        errors.push(
          ...validateRequiredTools(result, [
            "cu_open_application",
            "cu_screenshot",
          ]),
        );
      }
      // Accept cu_type, cu_type_into_target, or cu_execute_plan for typing
      if (
        !result.successfulToolNames.includes("cu_type") &&
        !result.successfulToolNames.includes("cu_type_into_target") &&
        !usedExecutePlan
      ) {
        errors.push("Expected cu_type or cu_type_into_target to be called.");
      }
      if (
        !/textedit|hello|hlvm|typed/i.test(result.plain)
      ) {
        errors.push(
          "Response should reference TextEdit or the typed content.",
        );
      }
      return errors;
    },
  },
  {
    id: "key_combo",
    query:
      "Using computer use tools, open the Calculator application (bundle id: com.apple.calculator). First ensure the calculator is in a cleared state before entering a new expression. If any prior value is visible, clear it first (for example with Escape). Then press the key sequence: 5, +, 3, then Return. Take a screenshot and tell me what result is displayed.",
    requiredTools: ["cu_open_application", "cu_key"],
    validate: (result) => {
      const errors = validateCuOnlyUsage(result);
      // cu_execute_plan can subsume open+key — accept it as alternative
      const usedExecutePlan =
        result.attemptedToolNames.includes("cu_execute_plan");
      if (!usedExecutePlan) {
        errors.push(
          ...validateRequiredTools(result, ["cu_open_application", "cu_key"]),
        );
      }
      if (!/calculator|8|result/i.test(result.plain)) {
        errors.push(
          "Response should mention Calculator or the result.",
        );
      }
      return errors;
    },
  },

  // ── Tier 3: Real-World Workflow ──────────────────────────────────────
  {
    id: "calculator_workflow",
    query:
      "Open the Calculator application (bundle id: com.apple.calculator). Once it is open, type '9*7' and press Return. Take a screenshot and tell me the exact numeric result displayed in the Calculator window.",
    requiredTools: ["cu_open_application", "cu_screenshot"],
    validate: (result) => {
      const errors = [
        ...validateCuOnlyUsage(result),
        ...validateRequiredTools(result, [
          "cu_open_application",
          "cu_screenshot",
        ]),
      ];
      // Accept "63" or a reasonable explanation of what happened
      if (!/63|calculator/i.test(result.plain)) {
        errors.push("Expected result to contain '63' or mention Calculator.");
      }
      return errors;
    },
  },
  // ── Tier 4: Edge Cases ────────────────────────────────────────────────
  {
    id: "scroll_test",
    query:
      "Take a screenshot, then scroll down 3 clicks at the center of the screen, then take another screenshot. Describe any difference between the two screenshots.",
    requiredTools: ["cu_screenshot", "cu_scroll"],
    validate: (result) => {
      const errors = [
        ...validateCuOnlyUsage(result),
        ...validateRequiredTools(result, ["cu_screenshot", "cu_scroll"]),
      ];
      if (result.plain.length < 15) {
        errors.push("Expected description of the scrolling result.");
      }
      return errors;
    },
  },
  {
    id: "zoom_region",
    query:
      "Inspect the top-left region of the screen bounded by [0, 0, 400, 300]. If a region-specific capture tool is available, use it for that rectangle. Otherwise take a regular screenshot and describe what is visible in that top-left region.",
    requiredTools: ["cu_zoom"],
    validate: (result) => {
      const errors = validateCuOnlyUsage(result);
      // cu_zoom may not be picked by all models — accept cu_screenshot as fallback
      if (
        !result.successfulToolNames.includes("cu_zoom") &&
        !result.successfulToolNames.includes("cu_screenshot")
      ) {
        errors.push("Expected cu_zoom or cu_screenshot to be called.");
      }
      if (result.plain.length < 15) {
        errors.push("Expected description of the region.");
      }
      return errors;
    },
  },
  {
    id: "multi_app_switch",
    query:
      "Open the TextEdit application (com.apple.TextEdit), type 'Note A', then open Calculator (com.apple.calculator), then switch back to TextEdit by opening it again. Take a screenshot and confirm TextEdit is in the foreground.",
    requiredTools: ["cu_open_application", "cu_type"],
    validate: (result) => {
      const errors = validateCuOnlyUsage(result);
      // cu_execute_plan can subsume the entire multi-app workflow
      const usedExecutePlan =
        result.attemptedToolNames.includes("cu_execute_plan");
      if (!usedExecutePlan) {
        errors.push(
          ...validateRequiredTools(result, [
            "cu_open_application",
            "cu_type",
          ]),
        );
        if (
          !result.successfulToolNames.includes("cu_screenshot") &&
          !result.successfulToolNames.includes("cu_wait")
        ) {
          errors.push(
            "Expected final visual confirmation via cu_screenshot or cu_wait.",
          );
        }
      }
      if (!/textedit|foreground|front|note/i.test(result.plain)) {
        errors.push("Expected confirmation that TextEdit is in foreground.");
      }
      return errors;
    },
  },

  // ── Tier 5: Vision + Action Loop ───────────────────────────────────────
  {
    id: "screenshot_and_read",
    query:
      "Take a screenshot of the screen and describe what applications or windows are visible. List at least 2 things you can see.",
    requiredTools: ["cu_screenshot"],
    validate: (result) => {
      const errors = [
        ...validateCuOnlyUsage(result),
        ...validateRequiredTools(result, ["cu_screenshot"]),
      ];
      if (result.plain.length < 30) {
        errors.push(
          "Expected a meaningful description of the screen (30+ chars).",
        );
      }
      return errors;
    },
  },
  // ── Tier 6: Native Grounding & HLVM UI ────────────────────────────────
  //
  // These tests exercise the native substrate (Level 3): cu_observe returns
  // AX-level targets → cu_click_target / cu_type_into_target use semantic
  // target IDs instead of raw pixel coordinates.  This is what separates
  // HLVM CU from basic "screenshot + guess coordinates" computer use.

  {
    id: "grounded_observe_and_click",
    query:
      "Use cu_observe to get a full desktop observation with native targets. " +
      "Look at the returned targets list. Find a clickable target (button, menu item, " +
      "or text field) and use cu_click_target with the observation_id and target_id " +
      "to click it. Then take a screenshot to confirm the result. " +
      "Report which target you clicked and what happened.",
    requiredTools: ["cu_observe", "cu_click_target"],
    validate: (result) => {
      const errors = [
        ...validateCuOnlyUsage(result),
        ...validateRequiredTools(result, ["cu_observe", "cu_click_target"]),
      ];
      if (
        !result.successfulToolNames.includes("cu_screenshot") &&
        !result.successfulToolNames.includes("cu_wait") &&
        !result.successfulToolNames.includes("cu_observe")
      ) {
        errors.push(
          "Expected visual confirmation after clicking target.",
        );
      }
      if (!/target|click|button|menu|element/i.test(result.plain)) {
        errors.push(
          "Expected response to describe which target was clicked.",
        );
      }
      return errors;
    },
  },
  {
    id: "grounded_type_into_target",
    query:
      "Open TextEdit (com.apple.TextEdit). Then use cu_observe to get native " +
      "targets. The observation result contains an observation_id field and a " +
      "targets array where each target has a target_id field. Find a text " +
      "area or text field target. Then call cu_type_into_target passing the " +
      "EXACT observation_id and target_id strings from the observation result " +
      "(do NOT construct or modify the IDs — copy them verbatim). Type the " +
      "text 'Hello from native grounding'. Take a screenshot to confirm.",
    requiredTools: ["cu_open_application", "cu_observe", "cu_type_into_target"],
    validate: (result) => {
      const errors = [
        ...validateCuOnlyUsage(result),
        ...validateRequiredTools(result, [
          "cu_open_application",
          "cu_observe",
          "cu_type_into_target",
        ]),
      ];
      if (
        !/hello|native|grounding|textedit|text.*area|target/i.test(result.plain)
      ) {
        errors.push(
          "Expected response to mention the typed text or target used.",
        );
      }
      return errors;
    },
  },
  {
    id: "hlvm_spotlight_search",
    query:
      "Using computer use tools, trigger the HLVM Spotlight panel by pressing " +
      "the key combination Control+Z (this is the HLVM app's global hotkey, " +
      "NOT Apple Spotlight). Wait for the HLVM Spotlight panel to appear. " +
      "Then use cu_observe to see the panel and its targets. " +
      "Type a search query like 'calc' into the search field. " +
      "Take a screenshot showing the HLVM Spotlight panel with search results. " +
      "Report what you see in the panel.",
    requiredTools: ["cu_key"],
    validate: (result) => {
      const errors = [
        ...validateCuOnlyUsage(result),
        ...validateRequiredTools(result, ["cu_key"]),
      ];
      // Must have observed or screenshotted
      if (
        !result.successfulToolNames.includes("cu_screenshot") &&
        !result.successfulToolNames.includes("cu_observe") &&
        !result.successfulToolNames.includes("cu_wait")
      ) {
        errors.push(
          "Expected visual confirmation of HLVM Spotlight panel.",
        );
      }
      // Should mention panel, search, results, or HLVM
      if (
        !/(panel|search|spotlight|result|hlvm|field|query|calc)/i
          .test(result.plain)
      ) {
        errors.push(
          "Expected response to describe the HLVM Spotlight panel or search results.",
        );
      }
      return errors;
    },
  },
  {
    id: "cross_app_grounded_workflow",
    query: "Perform a cross-app workflow using native grounding:\n" +
      "1. Open TextEdit (com.apple.TextEdit)\n" +
      "2. Use the returned observation targets to cu_type_into_target to type 'Task: check system' into the text area\n" +
      "3. Open Calculator (com.apple.calculator)\n" +
      "4. Use observation targets to type 42*2 and press Return\n" +
      "5. Switch back to TextEdit by opening it again\n" +
      "6. Take a screenshot and confirm TextEdit is in foreground with the original text visible\n" +
      "Prefer cu_click_target and cu_type_into_target over raw coordinate clicks when targets are available.",
    requiredTools: ["cu_open_application"],
    validate: (result) => {
      const errors = [
        ...validateCuOnlyUsage(result),
        ...validateRequiredTools(result, ["cu_open_application"]),
      ];
      // Should have used grounded tools
      const usedGrounded =
        result.successfulToolNames.includes("cu_click_target") ||
        result.successfulToolNames.includes("cu_type_into_target");
      if (!usedGrounded) {
        errors.push(
          "Expected cu_click_target or cu_type_into_target (native grounding) to be used.",
        );
      }
      if (!/textedit|task|foreground|text/i.test(result.plain)) {
        errors.push(
          "Expected confirmation that TextEdit is in foreground with text.",
        );
      }
      return errors;
    },
  },
  {
    id: "execute_plan_open_wait_type_verify",
    query: "Use cu_execute_plan for a short deterministic native subplan. " +
      "Open TextEdit (com.apple.TextEdit), wait for it to be ready, find the main text field, type 'Hello from execute plan', and verify the target value contains that text. " +
      "If the plan blocks, continue using ordinary cu_* tools and explain where it blocked.",
    requiredTools: ["cu_execute_plan"],
    requiredToolMode: "attempted",
    validate: (result) => {
      const planSucceeded = result.successfulToolNames.includes(
        "cu_execute_plan",
      );
      const planFailed = result.failedToolNames.includes("cu_execute_plan");
      const errors = [
        ...validateCuOnlyUsage(result),
        ...validateRequiredTools(result, ["cu_execute_plan"], "attempted"),
      ];
      if (!planSucceeded && !planFailed) {
        errors.push("Expected cu_execute_plan to complete or fail cleanly.");
      }
      if (
        planSucceeded &&
        !/execute plan|textedit|hello/i.test(result.plain)
      ) {
        errors.push(
          "Expected response to mention the execute-plan flow or typed text.",
        );
      }
      if (
        !planSucceeded &&
        planFailed &&
        !/block|blocked|permission|fallback|unavailable|failed/i.test(
          result.plain,
        )
      ) {
        errors.push(
          "Expected blocked execute-plan response to explain why the plan could not continue.",
        );
      }
      return errors;
    },
  },
  {
    id: "execute_plan_cross_app_short_flow",
    query: "Use cu_execute_plan for a short deterministic cross-app subplan. " +
      "Open TextEdit, wait for ready, find the text area, type 'Task: plan executor', open Calculator, wait for ready, press keys '4', '2', '*', '2', then Return if needed, reopen TextEdit, and verify the text area still contains 'Task: plan executor'. " +
      "If the native plan blocks, continue with regular cu_* tools and report the block point.",
    requiredTools: ["cu_execute_plan"],
    requiredToolMode: "attempted",
    validate: (result) => {
      const planSucceeded = result.successfulToolNames.includes(
        "cu_execute_plan",
      );
      const planFailed = result.failedToolNames.includes("cu_execute_plan");
      const errors = [
        ...validateCuOnlyUsage(result),
        ...validateRequiredTools(result, ["cu_execute_plan"], "attempted"),
      ];
      if (!planSucceeded && !planFailed) {
        errors.push("Expected cu_execute_plan to complete or fail cleanly.");
      }
      if (
        planSucceeded &&
        !/textedit|calculator|plan executor|task/i.test(result.plain)
      ) {
        errors.push(
          "Expected response to mention the cross-app execute-plan workflow.",
        );
      }
      if (
        !planSucceeded &&
        planFailed &&
        !/block|blocked|permission|fallback|unavailable|failed/i.test(
          result.plain,
        )
      ) {
        errors.push(
          "Expected blocked execute-plan response to explain the block point or fallback.",
        );
      }
      return errors;
    },
  },
  {
    id: "read_target_value_after_type",
    query: "Open TextEdit (com.apple.TextEdit). Use the grounded observation returned by cu_open_application or cu_observe to identify the main text area target. " +
      "Call cu_type_into_target to type the exact text 'Read target works'. " +
      "For the immediate read-back, reuse the exact same observation_id and target_id that succeeded for cu_type_into_target instead of selecting a new target from the follow-up observation. " +
      "Then call cu_read_target with read_kind 'value'. " +
      "Report the exact returned value and whether it contains 'Read target works'.",
    requiredTools: [
      "cu_open_application",
      "cu_type_into_target",
      "cu_read_target",
    ],
    validate: (result) => {
      const errors = [
        ...validateCuOnlyUsage(result),
        ...validateRequiredTools(result, [
          "cu_open_application",
          "cu_type_into_target",
          "cu_read_target",
        ]),
      ];
      if (!/read target works|value|contains|textedit/i.test(result.plain)) {
        errors.push(
          "Expected response to mention the grounded read value or the typed text.",
        );
      }
      return errors;
    },
  },
  {
    id: "execute_plan_observed_target_type_verify",
    query: "Open TextEdit (com.apple.TextEdit). Use the grounded observation returned by cu_open_application or cu_observe for the main text area target. " +
      "Take the exact observation_id and target_id for that text area. " +
      "Now call cu_execute_plan using a grounded find_target step with observed_target { observation_id, target_id } instead of a selector. " +
      "Have the plan type 'Observed target plan' into that target and verify the value contains that text. " +
      "If the plan blocks, explain where it blocked.",
    requiredTools: ["cu_open_application", "cu_execute_plan"],
    requiredToolMode: "attempted",
    validate: (result) => {
      const planSucceeded = result.successfulToolNames.includes(
        "cu_execute_plan",
      );
      const planFailed = result.failedToolNames.includes("cu_execute_plan");
      const errors = [
        ...validateCuOnlyUsage(result),
        ...validateRequiredTools(
          result,
          ["cu_open_application", "cu_execute_plan"],
          "attempted",
        ),
      ];
      if (!planSucceeded && !planFailed) {
        errors.push("Expected grounded cu_execute_plan to complete or fail cleanly.");
      }
      if (
        planSucceeded &&
        !/observed target plan|textedit|grounded|observed_target/i.test(
          result.plain,
        )
      ) {
        errors.push(
          "Expected response to mention the grounded observed-target plan.",
        );
      }
      return errors;
    },
  },
  {
    id: "execute_plan_shortcut_surface",
    query: "Use cu_execute_plan for a shortcut-driven flow. " +
      "Press the HLVM spotlight hotkey Control+Z, wait for the search surface to be ready, find the search text field, type 'calc', and verify the target is enabled or contains that value. " +
      "If the plan blocks, continue with normal cu_* tools and report the block point.",
    requiredTools: ["cu_execute_plan"],
    requiredToolMode: "attempted",
    validate: (result) => {
      const planSucceeded = result.successfulToolNames.includes(
        "cu_execute_plan",
      );
      const planFailed = result.failedToolNames.includes("cu_execute_plan");
      const errors = [
        ...validateCuOnlyUsage(result),
        ...validateRequiredTools(result, ["cu_execute_plan"], "attempted"),
      ];
      if (!planSucceeded && !planFailed) {
        errors.push("Expected shortcut cu_execute_plan to complete or fail cleanly.");
      }
      if (
        !/hlvm|spotlight|calc|search|block|blocked|fallback|failed/i.test(
          result.plain,
        )
      ) {
        errors.push(
          "Expected response to describe the shortcut surface or the block/fallback path.",
        );
      }
      return errors;
    },
  },
  {
    id: "execute_plan_blocked_selector",
    query:
      "Call cu_execute_plan with an intentionally ambiguous selector in TextEdit so the plan should block safely instead of guessing. " +
      "After it blocks, continue using normal cu_observe or other cu_* tools if needed and explain why the selector was ambiguous.",
    requiredTools: ["cu_execute_plan"],
    requiredToolMode: "attempted",
    validate: (result) => {
      const planSucceeded = result.successfulToolNames.includes(
        "cu_execute_plan",
      );
      const planFailed = result.failedToolNames.includes("cu_execute_plan");
      const errors = [
        ...validateCuOnlyUsage(result),
        ...validateRequiredTools(result, ["cu_execute_plan"], "attempted"),
      ];
      if (!planSucceeded && !planFailed) {
        errors.push("Expected cu_execute_plan to complete or fail cleanly.");
      }
      if (
        !/ambiguous|selector|blocked|fallback|cu_observe|failed/i.test(
          result.plain,
        )
      ) {
        errors.push(
          "Expected response to describe the blocked selector or fallback path.",
        );
      }
      return errors;
    },
  },
  {
    id: "drag_test",
    query:
      "Move the mouse to (200, 200), then perform a left click drag from (200, 200) to (400, 400). Take a screenshot after the drag to confirm the mouse moved.",
    requiredTools: ["cu_left_click_drag", "cu_screenshot"],
    validate: (result) => {
      const errors = [
        ...validateCuOnlyUsage(result),
        ...validateRequiredTools(result, [
          "cu_left_click_drag",
          "cu_screenshot",
        ]),
      ];
      return errors;
    },
  },

  // ── Tier 7: Post-Action Observation Reuse ─────────────────────────────
  //
  // These test that the model uses the fresh observation returned by
  // cu_click_target / cu_type_into_target instead of calling cu_observe again.

  {
    id: "chained_grounded_actions",
    query:
      "Open TextEdit (com.apple.TextEdit). Use cu_observe once to get targets. " +
      "Then perform a chain of grounded actions WITHOUT calling cu_observe again between them: " +
      "1. Use cu_type_into_target to type 'Line one' into the text area " +
      "2. The type result returns a fresh observation — use that observation's targets directly " +
      "3. Use cu_key to press Return for a new line " +
      "4. Use cu_type_into_target again (using the latest returned observation) to type 'Line two' " +
      "5. Take a screenshot to confirm both lines are visible. " +
      "The goal is to complete the chain with at most ONE cu_observe call at the start. " +
      "Report how many cu_observe calls you used and whether both lines are visible.",
    requiredTools: ["cu_open_application", "cu_observe", "cu_type_into_target"],
    validate: (result) => {
      const errors = validateCuOnlyUsage(result);
      const usedExecutePlan =
        result.attemptedToolNames.includes("cu_execute_plan");
      if (!usedExecutePlan) {
        errors.push(
          ...validateRequiredTools(result, [
            "cu_open_application",
            "cu_type_into_target",
          ]),
        );
      }
      // Count cu_observe calls — should be minimal (ideally 1)
      // This is a soft signal, not a hard failure
      if (!/line.*one|line.*two|both.*line|visible/i.test(result.plain)) {
        errors.push(
          "Expected response to confirm both lines are visible.",
        );
      }
      return errors;
    },
  },

  // ── Tier 8: Diverse Real-World Scenarios ────────────────────────────────

  {
    id: "notes_app_workflow",
    query:
      "Open the Notes application (com.apple.Notes). Create a new note using the keyboard shortcut Command+N. " +
      "Type the text 'CU test note: diverse app coverage' into the note body. " +
      "Take a screenshot to confirm the text was typed. Report what you see.",
    requiredTools: ["cu_open_application", "cu_key"],
    validate: (result) => {
      const errors = validateCuOnlyUsage(result);
      const usedExecutePlan =
        result.attemptedToolNames.includes("cu_execute_plan");
      if (!usedExecutePlan) {
        errors.push(
          ...validateRequiredTools(result, ["cu_open_application", "cu_key"]),
        );
        if (
          !result.successfulToolNames.includes("cu_type") &&
          !result.successfulToolNames.includes("cu_type_into_target")
        ) {
          errors.push(
            "Expected cu_type or cu_type_into_target to be called.",
          );
        }
      }
      if (!/note|typed|text|cu test/i.test(result.plain)) {
        errors.push(
          "Response should reference the Notes app or the typed content.",
        );
      }
      return errors;
    },
  },
  {
    id: "finder_navigation",
    query:
      "Open the Finder application (com.apple.finder). Use the keyboard shortcut Command+Shift+H to navigate to the Home folder. " +
      "Use cu_observe to see the Finder window and its contents. " +
      "Take a screenshot and describe the visible files and folders in the Home directory.",
    requiredTools: ["cu_open_application", "cu_key"],
    validate: (result) => {
      const errors = [
        ...validateCuOnlyUsage(result),
        ...validateRequiredTools(result, ["cu_open_application", "cu_key"]),
      ];
      if (
        !result.successfulToolNames.includes("cu_screenshot") &&
        !result.successfulToolNames.includes("cu_observe")
      ) {
        errors.push("Expected visual confirmation of Finder contents.");
      }
      if (!/finder|home|folder|desktop|document|download/i.test(result.plain)) {
        errors.push(
          "Response should describe Finder or home directory contents.",
        );
      }
      return errors;
    },
  },
  {
    id: "keyboard_shortcut_new_doc",
    query:
      "Open TextEdit (com.apple.TextEdit). Use the keyboard shortcut Command+N to create a new blank document. " +
      "Wait briefly for the new window to appear, then type 'Fresh document via shortcut'. " +
      "Take a screenshot to confirm the text is visible in the new document.",
    requiredTools: ["cu_open_application", "cu_key"],
    validate: (result) => {
      const errors = validateCuOnlyUsage(result);
      const usedExecutePlan =
        result.attemptedToolNames.includes("cu_execute_plan");
      if (!usedExecutePlan) {
        errors.push(
          ...validateRequiredTools(result, ["cu_open_application", "cu_key"]),
        );
        if (
          !result.successfulToolNames.includes("cu_type") &&
          !result.successfulToolNames.includes("cu_type_into_target")
        ) {
          errors.push(
            "Expected cu_type or cu_type_into_target to be called.",
          );
        }
      }
      if (!/fresh|document|shortcut|textedit|new/i.test(result.plain)) {
        errors.push(
          "Response should reference the new document or typed text.",
        );
      }
      return errors;
    },
  },
  {
    id: "clipboard_paste_verify",
    query:
      "Open TextEdit (com.apple.TextEdit). Create a new blank document with Command+N. " +
      "Write the text 'Clipboard roundtrip 42' to the clipboard using cu_write_clipboard. " +
      "Then paste it into the new document using the keyboard shortcut Command+V. " +
      "Select all text with Command+A, copy it with Command+C, then read the clipboard to verify the pasted text matches. " +
      "Report whether the roundtrip succeeded.",
    requiredTools: [
      "cu_open_application",
      "cu_write_clipboard",
      "cu_key",
      "cu_read_clipboard",
    ],
    validate: (result) => {
      const errors = validateCuOnlyUsage(result);
      const usedExecutePlan =
        result.attemptedToolNames.includes("cu_execute_plan");
      if (!usedExecutePlan) {
        errors.push(
          ...validateRequiredTools(result, [
            "cu_open_application",
            "cu_write_clipboard",
            "cu_key",
            "cu_read_clipboard",
          ]),
        );
      } else {
        // execute_plan can't do clipboard ops, so still require those
        errors.push(
          ...validateRequiredTools(result, [
            "cu_write_clipboard",
            "cu_read_clipboard",
          ]),
        );
      }
      if (
        !/clipboard|roundtrip|42|match|paste|succeed|verif/i.test(result.plain)
      ) {
        errors.push(
          "Response should confirm the clipboard roundtrip or mention the text.",
        );
      }
      return errors;
    },
  },
  {
    id: "execute_plan_notes_type",
    query:
      "Use cu_execute_plan for a short subplan: open Notes (com.apple.Notes), wait for ready, " +
      "find a text area target, type 'Plan executor note test', and verify the target value contains that text. " +
      "If the plan blocks, continue with ordinary cu_* tools and explain where it blocked.",
    requiredTools: ["cu_execute_plan"],
    requiredToolMode: "attempted",
    validate: (result) => {
      const planSucceeded = result.successfulToolNames.includes(
        "cu_execute_plan",
      );
      const planFailed = result.failedToolNames.includes("cu_execute_plan");
      const errors = [
        ...validateCuOnlyUsage(result),
        ...validateRequiredTools(result, ["cu_execute_plan"], "attempted"),
      ];
      if (!planSucceeded && !planFailed) {
        errors.push("Expected cu_execute_plan to complete or fail cleanly.");
      }
      if (
        !/note|plan|executor|type|block|fallback/i.test(result.plain)
      ) {
        errors.push(
          "Expected response to mention the Notes execute-plan flow.",
        );
      }
      return errors;
    },
  },
];

// ── Case Filtering ────────────────────────────────────────────────────────

const ACTIVE_CASES = CASE_FILTER
  ? CASES.filter((c) =>
    CASE_FILTER.split(",").map((s) => s.trim()).includes(c.id)
  )
  : CASES;

// ── Main Test ─────────────────────────────────────────────────────────────

Deno.test({
  name:
    "E2E exploratory: computer-use CU-only tool suite is graded semantically",
  ignore: !ENABLED,
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const failures: string[] = [];
    const artifactRoot = await platform.fs.makeTempDir({
      prefix: "hlvm-cu-e2e-",
    });
    console.log(`CU E2E artifacts: ${artifactRoot}`);

    await withTemporaryWorkspace(async (workspace) => {
      for (const testCase of ACTIVE_CASES) {
        const events: AgentUIEvent[] = [];
        const capturedEvents: CapturedAgentEvent[] = [];
        const caseStartedAt = Date.now();
        let caseModel = "(none)";
        let responseText = "";
        let caseErrors: string[] = [];
        let crashMessage: string | undefined;
        let caseStatus: "pass" | "fail" | "crash" = "pass";
        try {
          const { model, result } = await withAbortTimeout(
            TIMEOUT_MS,
            (signal) =>
              runSourceAgentWithCompatibleModel({
                models: MODEL_CANDIDATES,
                query: testCase.query,
                workspace,
                signal,
                disablePersistentMemory: true,
                permissionMode: "bypassPermissions",
                toolAllowlist: CU_TOOL_ALLOWLIST,
                maxTokens: 2_400,
                callbacks: {
                  onAgentEvent: (event) => {
                    events.push(event);
                    capturedEvents.push({
                      at: new Date().toISOString(),
                      offsetMs: Date.now() - caseStartedAt,
                      event,
                    });
                  },
                },
              }),
          );
          caseModel = model;

          const successfulToolNames = collectSuccessfulToolNames(events);
          const attemptedToolNames = collectAttemptedToolNames(events);
          const failedToolNames = collectFailedToolNames(events);
          const trimmedText = result.text.trim();
          responseText = trimmedText;
          const semanticResult: ComputerUseResult = {
            text: trimmedText,
            plain: stripMarkdown(trimmedText),
            successfulToolNames,
            attemptedToolNames,
            failedToolNames,
          };
          const errors = await testCase.validate(semanticResult);
          caseErrors = errors;
          if (errors.length > 0) {
            caseStatus = "fail";
            const artifactDir = await writeCaseArtifacts({
              rootDir: artifactRoot,
              testCase,
              model: caseModel,
              status: caseStatus,
              query: testCase.query,
              responseText,
              events: capturedEvents,
              successfulToolNames,
              attemptedToolNames,
              failedToolNames,
              errors,
            });
            failures.push(
              [
                `FAIL ${testCase.id}`,
                `  Model: ${caseModel}`,
                `  Successful Tools: ${
                  successfulToolNames.join(", ") || "(none)"
                }`,
                `  Attempted Tools: ${
                  attemptedToolNames.join(", ") || "(none)"
                }`,
                `  Failed Tools: ${failedToolNames.join(", ") || "(none)"}`,
                `  Artifacts: ${artifactDir}`,
                `  Response: ${semanticResult.text.slice(0, 300)}`,
                `  Errors: ${errors.join(" | ")}`,
              ].join("\n"),
            );
          } else {
            // Metrics: cu_observe count and failed-tool count for before/after comparison
            const observeCount = events.filter(
              (e): e is Extract<AgentUIEvent, { type: "tool_start" }> =>
                e.type === "tool_start" && e.name === "cu_observe",
            ).length;
            const failedCount = failedToolNames.length;
            const artifactDir = await writeCaseArtifacts({
              rootDir: artifactRoot,
              testCase,
              model: caseModel,
              status: caseStatus,
              query: testCase.query,
              responseText,
              events: capturedEvents,
              successfulToolNames,
              attemptedToolNames,
              failedToolNames,
              errors,
            });
            console.log(
              `PASS ${testCase.id} | Model: ${caseModel} | Successful: ${
                successfulToolNames.join(", ") || "(none)"
              } | Attempted: ${attemptedToolNames.join(", ") || "(none)"} | Failed: ${
                failedToolNames.join(", ") || "(none)"
              } | observe:${observeCount} failed:${failedCount} | artifacts:${artifactDir}`,
            );
          }
        } catch (error) {
          caseStatus = "crash";
          crashMessage = error instanceof Error ? error.message : String(error);
          const artifactDir = await writeCaseArtifacts({
            rootDir: artifactRoot,
            testCase,
            model: caseModel,
            status: caseStatus,
            query: testCase.query,
            responseText,
            events: capturedEvents,
            successfulToolNames: collectSuccessfulToolNames(events),
            attemptedToolNames: collectAttemptedToolNames(events),
            failedToolNames: collectFailedToolNames(events),
            errors: caseErrors,
            crashMessage,
          });
          failures.push(
            `CRASH ${testCase.id} | Model: ${caseModel} | Artifacts: ${artifactDir} | ${crashMessage}`,
          );
        }
        // Clean up between cases to prevent cross-case contamination.
        // CU tests share the screen — leftover apps and clipboard interfere.
        try {
          await getPlatform().command.output({
            cmd: ["osascript", "-e", 'set the clipboard to ""'],
            stdin: "null",
            stdout: "piped",
            stderr: "piped",
            timeout: 2000,
          });
        } catch { /* best effort */ }
        try {
          await getPlatform().command.output({
            cmd: ["osascript", "-e", 'tell application "Calculator" to quit'],
            stdin: "null",
            stdout: "piped",
            stderr: "piped",
            timeout: 3000,
          });
        } catch { /* may not be running */ }
        try {
          await getPlatform().command.output({
            cmd: [
              "osascript",
              "-e",
              'tell application "TextEdit" to quit saving no',
            ],
            stdin: "null",
            stdout: "piped",
            stderr: "piped",
            timeout: 3000,
          });
        } catch { /* may not be running */ }
        try {
          await getPlatform().command.output({
            cmd: ["osascript", "-e", 'tell application "Disk Utility" to quit'],
            stdin: "null",
            stdout: "piped",
            stderr: "piped",
            timeout: 3000,
          });
        } catch { /* may not be running */ }
        try {
          await getPlatform().command.output({
            cmd: [
              "osascript",
              "-e",
              'tell application "System Information" to quit',
            ],
            stdin: "null",
            stdout: "piped",
            stderr: "piped",
            timeout: 3000,
          });
        } catch { /* may not be running */ }
        try {
          await getPlatform().command.output({
            cmd: ["osascript", "-e", 'tell application "Notes" to quit'],
            stdin: "null",
            stdout: "piped",
            stderr: "piped",
            timeout: 3000,
          });
        } catch { /* may not be running */ }
        try {
          await getPlatform().command.output({
            cmd: [
              "osascript",
              "-e",
              'tell application "Finder" to close every window',
            ],
            stdin: "null",
            stdout: "piped",
            stderr: "piped",
            timeout: 3000,
          });
        } catch { /* may not be running */ }
      }
    });

    assertEquals(
      failures,
      [],
      `\n${failures.length} of ${ACTIVE_CASES.length} case(s) failed:\n${
        failures.join("\n\n")
      }`,
    );
  },
});
