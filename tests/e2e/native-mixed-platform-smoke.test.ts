/**
 * Opt-in end-to-end smoke test for mixed-family turns via Google.
 *
 * Requirements:
 *   - GOOGLE_API_KEY
 *   - HLVM_E2E_NATIVE_MIXED_PLATFORM=1
 *   - Network access
 *   - Run with:
 *     HLVM_E2E_NATIVE_MIXED_PLATFORM=1 deno test --allow-all tests/e2e/native-mixed-platform-smoke.test.ts
 */

import { assert, assertStringIncludes } from "jsr:@std/assert";
import { disposeAllSessions } from "../../src/hlvm/agent/agent-runner.ts";
import type { AgentUIEvent } from "../../src/hlvm/agent/orchestrator.ts";
import {
  assertHasProviderCitations,
  assertNoLocalToolEvents,
  hasEnvVar,
  makeInlineImageAttachment,
  runWithCompatibleModel,
  withIsolatedEnv,
} from "./native-provider-smoke-helpers.ts";

const MODEL_CANDIDATES = [
  "google/gemini-2.5-flash-lite",
  "google/gemini-2.5-flash",
  "google/gemini-2.0-flash-001",
] as const;
const TIMEOUT_MS = 120_000;

Deno.test({
  name:
    "E2E real LLM: Google mixed turn keeps vision.analyze and web.search coherent",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    if (
      !hasEnvVar("GOOGLE_API_KEY") ||
      !hasEnvVar("HLVM_E2E_NATIVE_MIXED_PLATFORM")
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
            "First inspect the attached image. Then use live web search right now to find the latest post on the official Deno blog. Reply with two labeled lines: image=<dominant color>; web=<exact post title>.",
          workspace,
          signal: controller.signal,
          toolAllowlist: ["web_search"],
          attachments: [makeInlineImageAttachment("red")],
          callbacks: {
            onAgentEvent: (event) => events.push(event),
          },
        });

        assert(
          MODEL_CANDIDATES.some((candidate) => candidate === model),
          `Expected a Google model candidate, got ${model}`,
        );
        assertNoLocalToolEvents(events, "web_search");
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
