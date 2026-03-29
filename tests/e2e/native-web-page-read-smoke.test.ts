/**
 * Opt-in end-to-end smoke test for conservative native web_fetch via Google.
 *
 * This path is intentionally gated because native page-read is only enabled for
 * the dedicated `web_fetch` surface and should be exercised deliberately.
 *
 * Requirements:
 *   - GOOGLE_API_KEY
 *   - HLVM_E2E_NATIVE_PAGE_READ=1
 *   - Network access
 *   - Run with:
 *     deno test --allow-all tests/e2e/native-web-page-read-smoke.test.ts
 */

import { disposeAllSessions } from "../../src/hlvm/agent/agent-runner.ts";
import type { AgentUIEvent } from "../../src/hlvm/agent/orchestrator.ts";
import {
  assertCapabilityRoute,
  assertHasProviderCitations,
  assertNoLocalToolEvents,
  hasEnvVar,
  runWithCompatibleModel,
  withIsolatedEnv,
} from "./native-provider-smoke-helpers.ts";

const MODEL_CANDIDATES = [
  "google/gemini-2.5-flash",
  "google/gemini-2.5-flash-lite",
] as const;
const TIMEOUT_MS = 120_000;
const TARGET_URL =
  "https://deno.com/blog/build-a-dinosaur-runner-game-with-deno-pt-1";

Deno.test({
  name:
    "E2E real LLM: Google uses native web_fetch on the dedicated conservative page-read surface",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    if (
      !hasEnvVar("GOOGLE_API_KEY") || !hasEnvVar("HLVM_E2E_NATIVE_PAGE_READ")
    ) {
      return;
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

    try {
      await withIsolatedEnv(async (workspace) => {
        const events: AgentUIEvent[] = [];

        const { result } = await runWithCompatibleModel({
          models: MODEL_CANDIDATES,
          query:
            `Use the provider-native page reader to read this exact URL: ${TARGET_URL}. Reply with the page title and the exact source URL. Do not use raw HTML mode.`,
          workspace,
          signal: controller.signal,
          runtimeMode: "auto",
          toolAllowlist: ["web_fetch"],
          callbacks: {
            onAgentEvent: (event) => events.push(event),
          },
        });

        assertCapabilityRoute(events, {
          capabilityId: "web.read",
          routePhase: "tool-start",
          selectedBackendKind: "provider-native",
        });
        assertNoLocalToolEvents(events, "web_fetch");
        assertHasProviderCitations(result);
      });
    } finally {
      clearTimeout(timeout);
      await disposeAllSessions();
    }
  },
});
