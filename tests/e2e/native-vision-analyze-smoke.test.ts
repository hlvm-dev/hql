/**
 * Opt-in end-to-end smoke test for provider-native vision.analyze via Claude Code Max auth.
 *
 * Requirements:
 *   - Claude Code Max subscription (run `claude login` first)
 *   - HLVM_E2E_NATIVE_VISION=1
 *   - Network access
 *   - Run with:
 *     HLVM_E2E_NATIVE_VISION=1 deno test --allow-all tests/e2e/native-vision-analyze-smoke.test.ts
 */

import { assert, assertStringIncludes } from "jsr:@std/assert";
import { disposeAllSessions } from "../../src/hlvm/agent/agent-runner.ts";
import type { AgentUIEvent } from "../../src/hlvm/agent/orchestrator.ts";
import {
  assertCapabilityRoute,
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
    "E2E real LLM: Claude Code activates turn-start vision.analyze for current-turn image attachments",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    if (!hasEnvVar("HLVM_E2E_NATIVE_VISION")) return;

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
          runtimeMode: "auto",
          attachments: [makeInlineImageAttachment("red")],
          callbacks: {
            onAgentEvent: (event) => events.push(event),
          },
        });

        assert(
          MODEL_CANDIDATES.some((candidate) => candidate === model),
          `Expected a Claude Code Max model candidate, got ${model}`,
        );
        assertCapabilityRoute(events, {
          capabilityId: "vision.analyze",
          routePhase: "turn-start",
          selectedBackendKind: "provider-native",
        });
        assertStringIncludes(result.text.toLowerCase(), "red");
      });
    } finally {
      clearTimeout(timeout);
      await disposeAllSessions();
    }
  },
});
