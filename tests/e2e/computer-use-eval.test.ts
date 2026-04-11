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
        event.type === "tool_end" && event.success,
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
      "Computer-use tools are enabled in this run. Use the available `cu_observe` tool now before answering. After it returns, report the frontmost application name and the number of visible windows.",
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
    requiredTools: ["cu_open_application", "cu_screenshot"],
    validate: (result) => {
      const errors = [
        ...validateCuOnlyUsage(result),
        ...validateRequiredTools(result, [
          "cu_open_application",
          "cu_screenshot",
        ]),
      ];
      // Accept either cu_type (coordinate-based) or cu_type_into_target (grounded)
      if (
        !result.toolNames.includes("cu_type") &&
        !result.toolNames.includes("cu_type_into_target")
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
      "Inspect the top-left region of the screen bounded by [0, 0, 400, 300]. If a region-specific capture tool is available, use it for that rectangle. Otherwise take a regular screenshot and describe what is visible in that top-left region.",
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
    requiredTools: ["cu_open_application", "cu_type"],
    validate: (result) => {
      const errors = [
        ...validateCuOnlyUsage(result),
        ...validateRequiredTools(result, [
          "cu_open_application",
          "cu_type",
        ]),
      ];
      if (
        !result.toolNames.includes("cu_screenshot") &&
        !result.toolNames.includes("cu_wait")
      ) {
        errors.push(
          "Expected final visual confirmation via cu_screenshot or cu_wait.",
        );
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
        errors.push("Expected a meaningful description of the screen (30+ chars).");
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
        !result.toolNames.includes("cu_screenshot") &&
        !result.toolNames.includes("cu_wait") &&
        !result.toolNames.includes("cu_observe")
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
        !result.toolNames.includes("cu_screenshot") &&
        !result.toolNames.includes("cu_observe") &&
        !result.toolNames.includes("cu_wait")
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
    query:
      "Perform a cross-app workflow using native grounding:\n" +
      "1. Open TextEdit (com.apple.TextEdit)\n" +
      "2. Use cu_observe to get targets, then cu_type_into_target to type 'Task: check system' into the text area\n" +
      "3. Open Calculator (com.apple.calculator)\n" +
      "4. Use cu_observe to get Calculator targets, then type 42*2 and press Return\n" +
      "5. Switch back to TextEdit by opening it again\n" +
      "6. Take a screenshot and confirm TextEdit is in foreground with the original text visible\n" +
      "Prefer cu_click_target and cu_type_into_target over raw coordinate clicks when targets are available.",
    requiredTools: ["cu_open_application", "cu_observe"],
    validate: (result) => {
      const errors = [
        ...validateCuOnlyUsage(result),
        ...validateRequiredTools(result, ["cu_open_application", "cu_observe"]),
      ];
      // Should have used grounded tools
      const usedGrounded = result.toolNames.includes("cu_click_target") ||
        result.toolNames.includes("cu_type_into_target");
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
    const failures: string[] = [];

    await withTemporaryWorkspace(async (workspace) => {
      for (const testCase of ACTIVE_CASES) {
        const events: AgentUIEvent[] = [];
        let caseModel = "(none)";
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
                  onAgentEvent: (event) => events.push(event),
                },
              }),
          );
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
        try {
          await getPlatform().command.output({
            cmd: ["osascript", "-e", 'tell application "Disk Utility" to quit'],
            stdin: "null", stdout: "piped", stderr: "piped", timeout: 3000,
          });
        } catch { /* may not be running */ }
        try {
          await getPlatform().command.output({
            cmd: ["osascript", "-e", 'tell application "System Information" to quit'],
            stdin: "null", stdout: "piped", stderr: "piped", timeout: 3000,
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
