/**
 * Opt-in end-to-end smoke test for mixed-family auto-mode turns via Claude Code Max auth.
 *
 * Requirements:
 *   - Claude Code Max subscription (run `claude login` first)
 *   - HLVM_E2E_NATIVE_MIXED_PLATFORM=1
 *   - Network access
 *   - Run with:
 *     HLVM_E2E_NATIVE_MIXED_PLATFORM=1 deno test --allow-all tests/e2e/native-mixed-platform-smoke.test.ts
 */

import { assert, assertStringIncludes } from "jsr:@std/assert";
import { disposeAllSessions } from "../../src/hlvm/agent/agent-runner.ts";
import type { AgentUIEvent } from "../../src/hlvm/agent/orchestrator.ts";
import {
  assertCapabilityRouteSequence,
  assertHasProviderCitations,
  assertNoLocalToolEvents,
  hasEnvVar,
  makeInlineImageAttachment,
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
    "E2E real LLM: mixed auto-mode turn keeps vision.analyze and web.search routing coherent",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    if (!hasEnvVar("HLVM_E2E_NATIVE_MIXED_PLATFORM")) return;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

    try {
      await withIsolatedEnv(async (workspace) => {
        const events: AgentUIEvent[] = [];

        const { model, result } = await runWithCompatibleModel({
          models: MODEL_CANDIDATES,
          query:
            "First inspect the attached image. Then use live web search right now to find the latest post on the official Deno blog. Reply with two labeled lines: image=<dominant color>; web=<exact post title>.",
          workspace,
          signal: controller.signal,
          runtimeMode: "auto",
          toolAllowlist: ["web_search"],
          attachments: [makeInlineImageAttachment("red")],
          callbacks: {
            onAgentEvent: (event) => events.push(event),
          },
        });

        assert(
          MODEL_CANDIDATES.some((candidate) => candidate === model),
          `Expected a Claude Code Max model candidate, got ${model}`,
        );
        assertCapabilityRouteSequence(events, [
          "turn-start:vision.analyze",
          "tool-start:web.search",
        ]);
        assertNoLocalToolEvents(events, "search_web");
        assertHasProviderCitations(result);
        assertStringIncludes(result.text.toLowerCase(), "red");
      });
    } finally {
      clearTimeout(timeout);
      await disposeAllSessions();
    }
  },
});
