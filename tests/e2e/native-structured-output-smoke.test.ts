/**
 * Opt-in end-to-end smoke test for provider-native structured.output via Google.
 *
 * Requirements:
 *   - GOOGLE_API_KEY
 *   - HLVM_E2E_NATIVE_STRUCTURED_OUTPUT=1
 *   - Network access
 *   - Run with:
 *     HLVM_E2E_NATIVE_STRUCTURED_OUTPUT=1 deno test --allow-all tests/e2e/native-structured-output-smoke.test.ts
 */

import { assert } from "jsr:@std/assert";
import { disposeAllSessions } from "../../src/hlvm/agent/agent-runner.ts";
import type { AgentUIEvent } from "../../src/hlvm/agent/orchestrator.ts";
import {
  assertStructuredResult,
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

Deno.test({
  name:
    "E2E real LLM: Google returns provider-native structured.output for explicit response_schema turns",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    if (
      !hasEnvVar("GOOGLE_API_KEY") ||
      !hasEnvVar("HLVM_E2E_NATIVE_STRUCTURED_OUTPUT")
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
            "Classify the sentiment of this sentence: 'I love HLVM.' Return a structured answer only.",
          workspace,
          signal: controller.signal,
          responseSchema: {
            type: "object",
            properties: {
              sentiment: { type: "string" },
              confidence: { type: "number" },
            },
            required: ["sentiment", "confidence"],
            additionalProperties: false,
          },
          callbacks: {
            onAgentEvent: (event) => events.push(event),
          },
        });

        assert(
          MODEL_CANDIDATES.some((candidate) => candidate === model),
          `Expected a Google model candidate, got ${model}`,
        );
        const structured = assertStructuredResult(result, [
          "sentiment",
          "confidence",
        ]);
        assert(
          typeof structured.sentiment === "string",
          `Expected structured sentiment string, got ${typeof structured.sentiment}`,
        );
        assert(
          typeof structured.confidence === "number",
          `Expected structured confidence number, got ${typeof structured.confidence}`,
        );
      });
    } finally {
      clearTimeout(timeout);
      await disposeAllSessions();
    }
  },
});
