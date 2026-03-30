/**
 * End-to-end smoke test for provider-native web_search via Google.
 *
 * Requirements:
 *   - GOOGLE_API_KEY
 *   - HLVM_E2E_NATIVE_GOOGLE_WEB_SEARCH=1
 *   - Network access
 *   - Run with:
 *     HLVM_E2E_NATIVE_GOOGLE_WEB_SEARCH=1 deno test --allow-all tests/e2e/native-google-web-search-smoke.test.ts
 */

import { assert } from "jsr:@std/assert";
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
  "google/gemini-2.5-flash-lite",
  "google/gemini-2.5-flash",
] as const;
const TIMEOUT_MS = 120_000;

Deno.test({
  name:
    "E2E real LLM: Google uses native web_search and returns provider-grounded citations",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    if (
      !hasEnvVar("GOOGLE_API_KEY") ||
      !hasEnvVar("HLVM_E2E_NATIVE_GOOGLE_WEB_SEARCH")
    ) {
      return;
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

    try {
      await withIsolatedEnv(async (workspace) => {
        const events: AgentUIEvent[] = [];

        const { model, result } = await runWithCompatibleModel({
          models: MODEL_CANDIDATES,
          query:
            "Use live web search right now to find the latest post on the official Deno blog. Reply with the post title and the exact source URL. Do not answer from memory.",
          workspace,
          signal: controller.signal,
          runtimeMode: "auto",
          toolAllowlist: ["web_search"],
          callbacks: {
            onAgentEvent: (event) => events.push(event),
          },
        });

        assert(
          MODEL_CANDIDATES.some((candidate) => candidate === model),
          `Expected a Google model candidate, got ${model}`,
        );
        assertCapabilityRoute(events, {
          capabilityId: "web.search",
          routePhase: "tool-start",
          selectedBackendKind: "provider-native",
        });
        assertNoLocalToolEvents(events, "web_search");
        assertNoLocalToolEvents(events, "search_web");
        assertHasProviderCitations(result);
      });
    } finally {
      clearTimeout(timeout);
      await disposeAllSessions();
    }
  },
});
