/**
 * Opt-in end-to-end smoke test for provider-native remote_code_execute via Google.
 *
 * Requirements:
 *   - GOOGLE_API_KEY
 *   - HLVM_E2E_NATIVE_REMOTE_CODE=1
 *   - Network access
 *   - Run with:
 *     deno test --allow-all tests/e2e/native-remote-code-smoke.test.ts
 */

import { assertEquals, assertMatch } from "jsr:@std/assert";
import { disposeAllSessions } from "../../src/hlvm/agent/agent-runner.ts";
import type { AgentUIEvent } from "../../src/hlvm/agent/orchestrator.ts";
import {
  assertCapabilityRoute,
  assertNoLocalToolEvents,
  hasEnvVar,
  runWithCompatibleModel,
  withIsolatedEnv,
} from "./native-provider-smoke-helpers.ts";

const MODEL_CANDIDATES = [
  "google/gemini-2.5-flash",
  "google/gemini-2.5-flash-lite",
  "google/gemini-2.0-flash-001",
] as const;
const TIMEOUT_MS = 120_000;

function toHex(bytes: Uint8Array): string {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(text),
  );
  return toHex(new Uint8Array(digest));
}

Deno.test({
  name:
    "E2E real LLM: Google uses remote_code_execute on the explicit remote-code surface",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    if (
      !hasEnvVar("GOOGLE_API_KEY") || !hasEnvVar("HLVM_E2E_NATIVE_REMOTE_CODE")
    ) {
      return;
    }

    const input = `hlvm-native-remote-${crypto.randomUUID()}`;
    const expectedDigest = await sha256Hex(input);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

    try {
      await withIsolatedEnv(async (workspace) => {
        const events: AgentUIEvent[] = [];

        const { result } = await runWithCompatibleModel({
          models: MODEL_CANDIDATES,
          query:
            `Use remote_code_execute to compute the SHA-256 of this exact string: ${input}. Return only the lowercase hex digest.`,
          workspace,
          signal: controller.signal,
          runtimeMode: "auto",
          toolAllowlist: ["remote_code_execute"],
          callbacks: {
            onAgentEvent: (event) => events.push(event),
          },
        });

        assertCapabilityRoute(events, {
          capabilityId: "code.exec",
          routePhase: "turn-start",
          selectedBackendKind: "provider-native",
        });
        assertNoLocalToolEvents(events, "remote_code_execute");
        const digest = result.text.trim().toLowerCase().match(/[a-f0-9]{64}/)
          ?.[0];
        assertMatch(result.text.trim().toLowerCase(), /[a-f0-9]{64}/);
        assertEquals(digest, expectedDigest);
      });
    } finally {
      clearTimeout(timeout);
      await disposeAllSessions();
    }
  },
});
