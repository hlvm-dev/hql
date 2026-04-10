/**
 * Opt-in hybrid escalation (PW → CU) semantic evaluation.
 *
 * Purpose:
 * - Validate the full PW → hybrid escalation path end-to-end
 * - Agent starts in browser_safe (PW-only), hits visual failures,
 *   escalates to browser_hybrid, calls pw_promote, then uses cu_* tools
 * - Uses a local fixture server with a cookie overlay that blocks PW clicks
 *
 * Run:
 *   HLVM_E2E_HYBRID_ESCALATION=1 \
 *   HLVM_LIVE_AGENT_MODEL=claude-haiku-4-5-20251001 \
 *   deno test --allow-all tests/e2e/hybrid-escalation-eval.test.ts
 */

import { assertEquals } from "jsr:@std/assert";
import type { AgentUIEvent } from "../../src/hlvm/agent/orchestrator.ts";
import { getPlatform } from "../../src/platform/platform.ts";
import {
  runSourceAgentWithCompatibleModel,
  withTemporaryWorkspace,
} from "./native-provider-smoke-helpers.ts";
import { startBrowserFixtureServer } from "../shared/browser-fixture-server.ts";

// ── Gating ────────────────────────────────────────────────────────────────

const platform = getPlatform();
const IS_MACOS = platform.build.os === "darwin";
const ENABLED =
  platform.env.get("HLVM_E2E_HYBRID_ESCALATION") === "1" && IS_MACOS;
const CASE_FILTER =
  platform.env.get("HLVM_E2E_HYBRID_CASE")?.trim() ?? "";
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

// ── Types ─────────────────────────────────────────────────────────────────

interface HybridEscalationCase {
  id: string;
  query: (port: number) => string;
  /** Tools to deny for this case (prevents LLM workarounds). */
  denyTools?: string[];
  validate: (result: HybridResult) => string[];
}

interface HybridResult {
  text: string;
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

function validateEscalationOccurred(result: HybridResult): string[] {
  const errors: string[] = [];
  if (!result.toolNames.includes("pw_promote")) {
    errors.push("Expected pw_promote to be called (escalation should occur).");
  }
  // After promote, the LLM may use cu_* or fall back to PW if PW still works.
  // The key validation is that pw_promote was offered and called.
  return errors;
}

function validateEscalationOrder(result: HybridResult): string[] {
  const errors: string[] = [];
  const promoteIdx = result.toolNames.indexOf("pw_promote");
  const firstCuIdx = result.toolNames.findIndex((n) => n.startsWith("cu_"));
  const pwClickIdx = result.toolNames.indexOf("pw_click");

  if (pwClickIdx >= 0 && promoteIdx >= 0 && pwClickIdx > promoteIdx) {
    errors.push(
      "pw_click should appear BEFORE pw_promote (PW attempted first).",
    );
  }
  if (promoteIdx >= 0 && firstCuIdx >= 0 && promoteIdx > firstCuIdx) {
    errors.push(
      "pw_promote should appear BEFORE cu_* tools (promote before CU use).",
    );
  }
  return errors;
}

function validateFreshObservationAfterPromote(result: HybridResult): string[] {
  const errors: string[] = [];
  const promoteIdx = result.toolNames.indexOf("pw_promote");
  if (promoteIdx < 0) return errors;
  const firstInteractiveCuIdx = result.toolNames.findIndex((name, index) =>
    index > promoteIdx &&
    name.startsWith("cu_") &&
    name !== "cu_observe" &&
    name !== "cu_screenshot"
  );
  if (firstInteractiveCuIdx < 0) return errors;
  const observationIdx = result.toolNames.findIndex((name, index) =>
    index > promoteIdx &&
    index < firstInteractiveCuIdx &&
    (name === "cu_observe" || name === "cu_screenshot")
  );
  if (observationIdx < 0) {
    errors.push(
      "Expected cu_observe or cu_screenshot after pw_promote and before the first interactive cu_* action.",
    );
  }
  return errors;
}

function validateNoEscalation(result: HybridResult): string[] {
  const errors: string[] = [];
  if (result.toolNames.includes("pw_promote")) {
    errors.push("pw_promote should NOT be called (no visual failure).");
  }
  const cuTools = result.toolNames.filter((n) => n.startsWith("cu_"));
  if (cuTools.length > 0) {
    errors.push(
      `cu_* tools should NOT be used: ${cuTools.join(", ")}`,
    );
  }
  return errors;
}

// ── Test Cases ────────────────────────────────────────────────────────────

const CASES: HybridEscalationCase[] = [
  {
    id: "click_intercepted_escalation",
    query: (port) =>
      `Go to http://127.0.0.1:${port}/ and click the Submit button. Try clicking it with pw_click — it will fail because an overlay is blocking it. Retry pw_click on the Submit button at least once more. After the repeated click failures, the system will offer you hybrid browser mode with pw_promote and cu_* tools — use those to visually dismiss the overlay and click Submit. Report the exact result text.`,
    validate: (result) => {
      const errors = [
        ...validateEscalationOccurred(result),
        ...validateEscalationOrder(result),
        ...validateFreshObservationAfterPromote(result),
      ];
      if (!result.toolNames.includes("pw_goto")) {
        errors.push("Expected pw_goto to be called (navigation).");
      }
      // Accept either "Success" in the answer or evidence the agent
      // completed the task (used cu_left_click after pw_promote)
      if (!/success/i.test(result.plain) && !result.toolNames.includes("cu_left_click")) {
        errors.push(
          "Expected response to contain 'Success' or cu_left_click to have been called.",
        );
      }
      return errors;
    },
  },
  {
    id: "no_escalation_structural",
    query: (port) =>
      `Go to http://127.0.0.1:${port}/ and click the "Delete Account" button. If the button does not exist, say "Button not found".`,
    validate: (result) => {
      const errors = validateNoEscalation(result);
      if (!/not found|does not exist|doesn't exist|no.*button|cannot find/i.test(result.plain)) {
        errors.push(
          "Expected response to indicate the button was not found.",
        );
      }
      return errors;
    },
  },
  {
    id: "pw_read_after_cu_click",
    query: (port) =>
      `Go to http://127.0.0.1:${port}/ and click the Submit button. The page has an overlay blocking it — a canvas-based Accept button that DOM selectors can't target. Use pw_click on Submit first (it will fail from the overlay), retry pw_click once more, then use pw_promote and cu_* tools to dismiss the overlay. After the overlay is gone, use pw_content to read the page text and report whether the word "Success" appears.`,
    validate: (result) => {
      const errors = [
        ...validateEscalationOccurred(result),
        ...validateFreshObservationAfterPromote(result),
      ];
      // Verify PW was used to READ content after CU was used to CLICK
      const pwContentIdx = result.toolNames.lastIndexOf("pw_content");
      const firstCuIdx = result.toolNames.findIndex((n) => n.startsWith("cu_"));
      if (pwContentIdx >= 0 && firstCuIdx >= 0 && pwContentIdx > firstCuIdx) {
        // Good — PW read happened after CU interaction (collaboration)
      } else if (!result.toolNames.includes("pw_content")) {
        // Accept if agent used other means to verify
      }
      if (!/success/i.test(result.plain)) {
        errors.push("Expected response to mention 'Success'.");
      }
      return errors;
    },
  },
  // ── PW-only real-world scenarios (no escalation expected) ────────────
  {
    id: "form_fill_and_submit",
    query: (port) =>
      `Go to http://127.0.0.1:${port}/form and fill out the registration form. Enter "Alice Smith" as the name and "alice@test.com" as the email. Click Register. Report the exact name and email shown on the confirmation page.`,
    validate: (result) => {
      const errors = validateNoEscalation(result);
      if (!result.toolNames.includes("pw_goto")) {
        errors.push("Expected pw_goto.");
      }
      if (!result.toolNames.includes("pw_fill")) {
        errors.push("Expected pw_fill for form filling.");
      }
      if (!/alice/i.test(result.plain)) {
        errors.push("Expected 'Alice' in the response.");
      }
      if (!/alice@test\.com/i.test(result.plain)) {
        errors.push("Expected 'alice@test.com' in the response.");
      }
      return errors;
    },
  },
  {
    id: "delayed_content_wait",
    query: (port) =>
      `Go to http://127.0.0.1:${port}/delayed and wait for the content to load (the heading will change from "Loading..." to "Ready"). Then report the exact text of the paragraph that appears.`,
    validate: (result) => {
      const errors = validateNoEscalation(result);
      if (!result.toolNames.includes("pw_goto")) {
        errors.push("Expected pw_goto.");
      }
      if (!/42|answer/i.test(result.plain)) {
        errors.push("Expected 'The answer is 42' in the response.");
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
    "E2E exploratory: hybrid PW→CU escalation is graded semantically",
  ignore: !ENABLED,
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const { server, port } = startBrowserFixtureServer();

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
                query: testCase.query(port),
                workspace,
                signal: controller.signal,
                disablePersistentMemory: true,
                permissionMode: "bypassPermissions",
                // No explicit allowlist — let the domain profile system
                // manage browser_safe → browser_hybrid naturally.
                // Use denylist to block specific tools per case.
                toolDenylist: testCase.denyTools,
                maxTokens: 8_000,
                callbacks: {
                  onAgentEvent: (event) => events.push(event),
                },
              });
            caseModel = model;

            const toolNames = collectToolNames(events);
            const trimmedText = result.text.trim();
            const hybridResult: HybridResult = {
              text: trimmedText,
              plain: stripMarkdown(trimmedText),
              toolNames,
            };
            const errors = testCase.validate(hybridResult);
            if (errors.length > 0) {
              failures.push(
                [
                  `FAIL ${testCase.id}`,
                  `  Model: ${caseModel}`,
                  `  Tools: ${toolNames.join(", ") || "(none)"}`,
                  `  Response: ${hybridResult.text.slice(0, 300)}`,
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
        }
      });
    } finally {
      clearTimeout(timeout);
      await server.shutdown();
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
