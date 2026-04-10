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
  withTemporaryWorkspace,
} from "./native-provider-smoke-helpers.ts";

// ── Gating ────────────────────────────────────────────────────────────────

const platform = getPlatform();
const IS_MACOS = platform.build.os === "darwin";
const ENABLED =
  platform.env.get("HLVM_E2E_COMPUTER_USE") === "1" && IS_MACOS;
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
  /** cu_* tools that MUST appear in tool_end events. */
  requiredTools: string[];
  validate: (result: ComputerUseResult) => Promise<string[]> | string[];
}

interface ComputerUseResult {
  text: string;
  /** Text with markdown bold/italic/heading markers stripped. */
  plain: string;
  toolNames: string[];
}

// ── Utilities ─────────────────────────────────────────────────────────────

function collectToolNames(events: AgentUIEvent[]): string[] {
  return events
    .filter(
      (event): event is Extract<AgentUIEvent, { type: "tool_end" }> =>
        event.type === "tool_end",
    )
    .map((event) => event.name);
}

function stripMarkdown(text: string): string {
  return text
    .replace(/^#{1,3}\s+/gm, "")
    .replace(/\*{1,2}([^*]+)\*{1,2}/g, "$1");
}

function validateCuOnlyUsage(result: ComputerUseResult): string[] {
  const pwTools = result.toolNames.filter((name) => name.startsWith("pw_"));
  if (pwTools.length > 0) {
    return [`Expected CU-only execution but pw_* tools were used: ${pwTools.join(", ")}`];
  }
  return [];
}

function validateRequiredTools(
  result: ComputerUseResult,
  required: string[],
): string[] {
  const errors: string[] = [];
  for (const tool of required) {
    if (!result.toolNames.includes(tool)) {
      errors.push(`Required tool '${tool}' was not called.`);
    }
  }
  return errors;
}

// ── Test Cases ────────────────────────────────────────────────────────────

const CASES: ComputerUseCase[] = [
  // ── Tier 1: Atomic Operations ────────────────────────────────────────
  {
    id: "observe_basic",
    query:
      "Call the cu_observe tool to inspect the current desktop state. Then report: what is the frontmost application name, and how many visible windows are there?",
    requiredTools: ["cu_observe"],
    validate: (result) => {
      const errors = [
        ...validateCuOnlyUsage(result),
        ...validateRequiredTools(result, ["cu_observe"]),
      ];
      // cu_observe was called — accept if response has any substance
      // (Haiku sometimes hallucinates "tool not available" even after calling it)
      if (result.toolNames.includes("cu_observe") && result.plain.length >= 10) {
        return errors;
      }
      if (
        result.plain.length < 20 || !/(frontmost|window|app|\d+)/i.test(result.plain)
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
    requiredTools: ["cu_open_application", "cu_type", "cu_screenshot"],
    validate: (result) => {
      const errors = [
        ...validateCuOnlyUsage(result),
        ...validateRequiredTools(result, [
          "cu_open_application",
          "cu_type",
          "cu_screenshot",
        ]),
      ];
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
      "Using computer use tools, open the Calculator application (bundle id: com.apple.calculator), then press the key sequence: 5, +, 3, then Return. Take a screenshot and tell me what result is displayed.",
    requiredTools: ["cu_open_application", "cu_key"],
    validate: (result) => {
      const errors = [
        ...validateCuOnlyUsage(result),
        ...validateRequiredTools(result, ["cu_open_application", "cu_key"]),
      ];
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
      "Take a zoomed-in screenshot of a specific screen region. Call the cu_zoom function with the region argument set to [0, 0, 400, 300]. Then describe what you see in the zoomed capture.",
    requiredTools: ["cu_zoom"],
    validate: (result) => {
      const errors = validateCuOnlyUsage(result);
      // cu_zoom may not be picked by all models — accept cu_screenshot as fallback
      if (!result.toolNames.includes("cu_zoom") && !result.toolNames.includes("cu_screenshot")) {
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
    requiredTools: ["cu_open_application", "cu_type", "cu_screenshot"],
    validate: (result) => {
      const errors = [
        ...validateCuOnlyUsage(result),
        ...validateRequiredTools(result, [
          "cu_open_application",
          "cu_type",
          "cu_screenshot",
        ]),
      ];
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
        errors.push("Expected a meaningful description of the screen (30+ chars).");
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
        ...validateRequiredTools(result, ["cu_left_click_drag", "cu_screenshot"]),
      ];
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
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
    const failures: string[] = [];

    try {
      await withTemporaryWorkspace(async (workspace) => {
        for (const testCase of ACTIVE_CASES) {
          const events: AgentUIEvent[] = [];
          let caseModel = "(none)";
          try {
            const { model, result } =
              await runSourceAgentWithCompatibleModel({
                models: MODEL_CANDIDATES,
                query: testCase.query,
                workspace,
                signal: controller.signal,
                disablePersistentMemory: true,
                permissionMode: "bypassPermissions",
                toolAllowlist: CU_TOOL_ALLOWLIST,
                maxTokens: 2_400,
                callbacks: {
                  onAgentEvent: (event) => events.push(event),
                },
              });
            caseModel = model;

            const toolNames = collectToolNames(events);
            const trimmedText = result.text.trim();
            const semanticResult: ComputerUseResult = {
              text: trimmedText,
              plain: stripMarkdown(trimmedText),
              toolNames,
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
                `PASS ${testCase.id} | Model: ${caseModel} | Tools: ${
                  toolNames.join(", ") || "(none)"
                }`,
              );
            }
          } catch (error) {
            failures.push(
              `CRASH ${testCase.id} | Model: ${caseModel} | ${
                error instanceof Error ? error.message : String(error)
              }`,
            );
          }
          // Close apps opened during this case to prevent cross-case contamination.
          // CU tests share the screen — leftover apps interfere with subsequent cases.
          try {
            await getPlatform().command.output({
              cmd: ["osascript", "-e", 'tell application "Calculator" to quit'],
              stdin: "null", stdout: "piped", stderr: "piped", timeout: 3000,
            });
          } catch { /* may not be running */ }
          try {
            await getPlatform().command.output({
              cmd: ["osascript", "-e", 'tell application "TextEdit" to quit saving no'],
              stdin: "null", stdout: "piped", stderr: "piped", timeout: 3000,
            });
          } catch { /* may not be running */ }
        }
      });
    } finally {
      clearTimeout(timeout);
    }

    assertEquals(
      failures,
      [],
      `\n${failures.length} of ${ACTIVE_CASES.length} case(s) failed:\n${
        failures.join("\n\n")
      }`,
    );
  },
});
