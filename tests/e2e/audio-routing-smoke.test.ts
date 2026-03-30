/**
 * Opt-in end-to-end smoke test for audio routing via Google when pinned to OpenAI.
 *
 * Requirements:
 *   - GOOGLE_API_KEY and OPENAI_API_KEY
 *   - HLVM_E2E_AUDIO_ROUTING=1
 *   - Network access
 *   - Run with:
 *     HLVM_E2E_AUDIO_ROUTING=1 deno test --allow-all tests/e2e/audio-routing-smoke.test.ts
 */

import { assert } from "jsr:@std/assert";
import { disposeAllSessions } from "../../src/hlvm/agent/agent-runner.ts";
import type { AgentUIEvent } from "../../src/hlvm/agent/orchestrator.ts";
import {
  assertCapabilityRoute,
  hasEnvVar,
  runWithCompatibleModel,
  withIsolatedEnv,
} from "./native-provider-smoke-helpers.ts";

const TIMEOUT_MS = 120_000;

Deno.test({
  name:
    "E2E real LLM: audio.analyze routes to Google provider-native when audio attachment is present",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    if (
      !hasEnvVar("GOOGLE_API_KEY") ||
      !hasEnvVar("HLVM_E2E_AUDIO_ROUTING")
    ) {
      return;
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

    try {
      await withIsolatedEnv(async (workspace) => {
        const events: AgentUIEvent[] = [];

        // Use Google model since we need audio support and are testing the
        // routing decision — not the cross-provider switch (that's the
        // reasoning smoke test).
        const { result } = await runWithCompatibleModel({
          models: [
            "google/gemini-2.5-flash",
            "google/gemini-2.0-flash-001",
          ],
          query: "Reply with just the word 'acknowledged'.",
          workspace,
          signal: controller.signal,
          runtimeMode: "auto",
          attachments: [
            {
              mode: "binary",
              attachmentId: "att-audio-silence",
              fileName: "silence.mp3",
              mimeType: "audio/mpeg",
              kind: "audio",
              conversationKind: "audio",
              size: 64,
              // Tiny valid-ish MP3 frame header (will be accepted as audio attachment
              // even if the content is too short to decode — the routing decision is
              // made based on attachment metadata, not content).
              data: "//uQxAAAAAANIAAAAAExBTUUzLjEwMFVVVVVVVVVVVVVVVVVV",
            },
          ],
          callbacks: {
            onAgentEvent: (event) => events.push(event),
          },
        });

        assertCapabilityRoute(events, {
          capabilityId: "audio.analyze",
          routePhase: "turn-start",
          selectedBackendKind: "provider-native",
        });

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
