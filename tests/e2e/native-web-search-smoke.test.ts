/**
 * Exploratory opt-in smoke test for provider-native web_search via Claude Code Max auth.
 *
 * Uses a REAL Claude Code Max model through Claude Code OAuth and proves:
 *   1. HLVM exposes the native web_search capability to the model
 *   2. The real model can answer a current-information query through live web search
 *   3. HLVM surfaces provider-native grounding as provider citations on the final response
 *   4. The custom local search_web tool is not used on the native Claude path
 *
 * Requirements:
 *   - Claude Code Max subscription (run `claude login` first)
 *   - HLVM_E2E_NATIVE_WEB_SEARCH=1
 *   - Network access
 *   - Run with:
 *     HLVM_E2E_NATIVE_WEB_SEARCH=1 deno test --allow-all tests/e2e/native-web-search-smoke.test.ts
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
  "claude-code/claude-opus-4-6",
  "claude-code/claude-sonnet-4-5-20250929",
  "claude-code/claude-haiku-4-5-20251001",
] as const;
const TIMEOUT_MS = 120_000;

Deno.test({
  name:
    "E2E exploratory: Claude Code uses native web_search and returns provider-grounded citations",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    if (!hasEnvVar("HLVM_E2E_NATIVE_WEB_SEARCH")) return;

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
          `Expected a Claude Code Max model candidate, got ${model}`,
        );
        assertCapabilityRoute(events, {
          capabilityId: "web.search",
          routePhase: "tool-start",
          selectedBackendKind: "provider-native",
        });
        assertNoLocalToolEvents(events, "search_web");
        assertHasProviderCitations(result);
      });
    } finally {
      clearTimeout(timeout);
      await disposeAllSessions();
    }
  },
});
