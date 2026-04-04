/**
 * Opt-in end-to-end smoke test for provider-native vision.analyze via Google.
 *
 * Requirements:
 *   - GOOGLE_API_KEY
 *   - HLVM_E2E_NATIVE_VISION=1
 *   - Network access
 *   - Run with:
 *     HLVM_E2E_NATIVE_VISION=1 deno test --allow-all tests/e2e/native-vision-analyze-smoke.test.ts
 */

import { assert, assertStringIncludes } from "jsr:@std/assert";
import { disposeAllSessions } from "../../src/hlvm/agent/agent-runner.ts";
import type { AgentUIEvent } from "../../src/hlvm/agent/orchestrator.ts";
import {
  hasEnvVar,
  makeInlineImageAttachment,
  runWithCompatibleModel,
  withIsolatedEnv,
} from "./native-provider-smoke-helpers.ts";

const MODEL_CANDIDATES = [
  "google/gemini-2.5-flash",
  "google/gemini-2.5-flash-lite",
  "google/gemini-2.0-flash-001",
] as const;
const TIMEOUT_MS = 120_000;

Deno.test({
  name:
    "E2E real LLM: Google activates turn-start vision.analyze for current-turn image attachments",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    if (!hasEnvVar("GOOGLE_API_KEY") || !hasEnvVar("HLVM_E2E_NATIVE_VISION")) {
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
            "Analyze the attached image and reply with just the dominant color name.",
          workspace,
          signal: controller.signal,
          attachments: [makeInlineImageAttachment("red")],
          callbacks: {
            onAgentEvent: (event) => events.push(event),
          },
        });

        assert(
          MODEL_CANDIDATES.some((candidate) => candidate === model),
          `Expected a Google model candidate, got ${model}`,
        );
        assertStringIncludes(result.text.toLowerCase(), "red");
      });
    } finally {
      clearTimeout(timeout);
      await disposeAllSessions();
    }
  },
});
