/**
 * Opt-in end-to-end smoke test for computer.use routing via Anthropic.
 * Verifies that the computer.use tool definition reaches the model when
 * explicitly requested, and that the routing decision is recorded.
 *
 * This tests ROUTING only (that the tool definition reaches the model),
 * not actual desktop automation.
 *
 * Requirements:
 *   - ANTHROPIC_API_KEY
 *   - HLVM_E2E_COMPUTER_USE=1
 *   - Network access
 *   - Run with:
 *     HLVM_E2E_COMPUTER_USE=1 deno test --allow-all tests/e2e/computer-use-routing-smoke.test.ts
 */

import { assert, assertExists } from "jsr:@std/assert";
import { disposeAllSessions, runAgentQuery } from "../../src/hlvm/agent/agent-runner.ts";
import type { AgentUIEvent } from "../../src/hlvm/agent/orchestrator.ts";
import {
  assertCapabilityRoute,
  getCapabilityRouteEvents,
  hasEnvVar,
  withIsolatedEnv,
} from "./native-provider-smoke-helpers.ts";

const TIMEOUT_MS = 120_000;

Deno.test({
  name:
    "E2E real LLM: computer.use routing proof — tool definition reaches Anthropic model when explicitly requested",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    if (
      !hasEnvVar("ANTHROPIC_API_KEY") ||
      !hasEnvVar("HLVM_E2E_COMPUTER_USE")
    ) {
      return;
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

    try {
      await withIsolatedEnv(async (workspace) => {
        const events: AgentUIEvent[] = [];

        // Pin to Anthropic with computerUse=true to exercise the routing path.
        const result = await runAgentQuery({
          query:
            "Reply with just the word 'acknowledged'. Do not use any tools.",
          model: "anthropic/claude-sonnet-4-5-20250929",
          workspace,
          permissionMode: "bypassPermissions",
          runtimeMode: "auto",
          computerUse: true,
          disablePersistentMemory: true,
          signal: controller.signal,
          callbacks: {
            onAgentEvent: (event) => events.push(event),
          },
        });

        // Verify computer.use was routed to provider-native
        assertCapabilityRoute(events, {
          capabilityId: "computer.use",
          routePhase: "turn-start",
          selectedBackendKind: "provider-native",
        });

        // Verify the model produced a response
        assert(
          result.text.length > 0,
          "Expected a non-empty response",
        );
      });
    } finally {
      clearTimeout(timeout);
      await disposeAllSessions();
    }
  },
});
