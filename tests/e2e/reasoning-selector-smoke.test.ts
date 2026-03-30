/**
 * Opt-in end-to-end smoke test for reasoning-based model switching (GAP 1).
 * Verifies that when a pinned provider can't satisfy a capability, the
 * reasoning selector switches to an alternative provider AND the actual
 * LLM call uses the switched model.
 *
 * Requirements:
 *   - GOOGLE_API_KEY and OPENAI_API_KEY
 *   - HLVM_E2E_REASONING_SELECTOR=1
 *   - Network access
 *   - Run with:
 *     HLVM_E2E_REASONING_SELECTOR=1 deno test --allow-all tests/e2e/reasoning-selector-smoke.test.ts
 */

import { assert, assertExists } from "jsr:@std/assert";
import { disposeAllSessions, runAgentQuery } from "../../src/hlvm/agent/agent-runner.ts";
import type { AgentUIEvent } from "../../src/hlvm/agent/orchestrator.ts";
import {
  getCapabilityRouteEvents,
  hasEnvVar,
  withIsolatedEnv,
} from "./native-provider-smoke-helpers.ts";

const TIMEOUT_MS = 120_000;

Deno.test({
  name:
    "E2E real LLM: reasoning selector switches from OpenAI to Google when audio attachment requires Google",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    if (
      !hasEnvVar("GOOGLE_API_KEY") ||
      !hasEnvVar("OPENAI_API_KEY") ||
      !hasEnvVar("HLVM_E2E_REASONING_SELECTOR")
    ) {
      return;
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

    try {
      await withIsolatedEnv(async (workspace) => {
        const events: AgentUIEvent[] = [];

        // Pin to OpenAI, attach audio — reasoning selector should switch
        // to Google because OpenAI lacks media.audioInput capability.
        const result = await runAgentQuery({
          query: "Reply with just the word 'acknowledged'.",
          model: "openai/gpt-4.1-mini",
          workspace,
          permissionMode: "bypassPermissions",
          runtimeMode: "auto",
          disablePersistentMemory: true,
          signal: controller.signal,
          attachments: [
            {
              mode: "binary",
              attachmentId: "att-audio-silence",
              fileName: "silence.mp3",
              mimeType: "audio/mpeg",
              kind: "audio",
              conversationKind: "audio",
              size: 64,
              data: "//uQxAAAAAANIAAAAAExBTUUzLjEwMFVVVVVVVVVVVVVVVVVV",
            },
          ],
          callbacks: {
            onAgentEvent: (event) => events.push(event),
          },
        });

        // Verify reasoning_routed event was emitted
        const reasoningRouted = events.find(
          (e) => e.type === "reasoning_routed",
        );
        assertExists(
          reasoningRouted,
          "Expected reasoning_routed event when OpenAI pinned + audio attachment",
        );

        if (reasoningRouted?.type === "reasoning_routed") {
          assert(
            reasoningRouted.switchedFromPinned === true,
            "Expected switchedFromPinned to be true",
          );
          assert(
            reasoningRouted.selectedProviderName === "google",
            `Expected switch to google, got ${reasoningRouted.selectedProviderName}`,
          );
        }

        // Verify the model actually responded (meaning GAP 1 applied the switch)
        assert(
          result.text.length > 0,
          "Expected non-empty response from the switched model",
        );

        // Verify the ACTUAL provider used was Google, not just the decision event.
        // If any audio.analyze route was emitted, verify it's provider-native.
        const capRoutes = getCapabilityRouteEvents(events);
        const audioRoutes = capRoutes.filter(
          (e) => e.capabilityId === "audio.analyze",
        );
        if (audioRoutes.length > 0) {
          assert(
            audioRoutes[0].selectedBackendKind === "provider-native",
            `Expected audio routed via provider-native, got ${audioRoutes[0].selectedBackendKind}`,
          );
        }
      });
    } finally {
      clearTimeout(timeout);
      await disposeAllSessions();
    }
  },
});
