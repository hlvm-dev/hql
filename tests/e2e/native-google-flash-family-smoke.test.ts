/**
 * End-to-end smoke matrix for the Google Flash family.
 *
 * This broadens live proof beyond a single model by verifying the same
 * provider-native surface against multiple Google Flash variants.
 *
 * Requirements:
 *   - GOOGLE_API_KEY
 *   - Network access
 *   - Run with:
 *     deno test --allow-all tests/e2e/native-google-flash-family-smoke.test.ts
 */

import { assertEquals } from "jsr:@std/assert";
import { disposeAllSessions } from "../../src/hlvm/agent/agent-runner.ts";
import type { AgentUIEvent } from "../../src/hlvm/agent/orchestrator.ts";
import {
  assertNoLocalToolEvents,
  hasEnvVar,
  withIsolatedEnv,
} from "./native-provider-smoke-helpers.ts";
import { runAgentQuery } from "../../src/hlvm/agent/agent-runner.ts";

const MODELS = [
  "google/gemini-2.5-flash",
  "google/gemini-2.5-flash-lite",
] as const;
const TIMEOUT_MS = 120_000;
const MAX_ATTEMPTS_PER_MODEL = 2;

Deno.test({
  name:
    "E2E real LLM: Google Flash family uses native web_search with provider citations",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    if (!hasEnvVar("GOOGLE_API_KEY")) return;

    const results: Array<{
      model: string;
      providerCitations: number;
      localSearchEvents: number;
    }> = [];

    for (const model of MODELS) {
      let lastError: unknown;

      for (let attempt = 1; attempt <= MAX_ATTEMPTS_PER_MODEL; attempt++) {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

        try {
          let recorded = false;
          await withIsolatedEnv(async (workspace) => {
            const events: AgentUIEvent[] = [];
            const result = await runAgentQuery({
              query:
                "Use live web search right now to find the latest post on the official Deno blog. Reply with the post title and exact source URL only. Do not answer from memory.",
              model,
              workspace,
              permissionMode: "yolo",
              toolAllowlist: ["web_search"],
              disablePersistentMemory: true,
              signal: controller.signal,
              callbacks: {
                onAgentEvent: (event) => events.push(event),
              },
            });

            assertNoLocalToolEvents(events, "search_web");

            const providerCitations =
              result.finalResponseMeta?.citationSpans?.filter((citation) =>
                citation.provenance === "provider"
              ).length ?? 0;
            if (providerCitations === 0) {
              throw new Error(
                `Expected provider-grounded citations, got none. Response: ${
                  result.text.slice(0, 200)
                }`,
              );
            }

            const localSearchEvents = events.filter((event) =>
              (event.type === "tool_start" || event.type === "tool_end") &&
              event.name === "search_web"
            ).length;

            results.push({ model, providerCitations, localSearchEvents });
            recorded = true;
          });
          if (recorded) {
            lastError = undefined;
            break;
          }
        } catch (error) {
          lastError = error;
        } finally {
          clearTimeout(timeout);
          await disposeAllSessions();
        }
      }

      if (lastError) {
        throw lastError;
      }
    }

    assertEquals(results.map((result) => result.model), [...MODELS]);
  },
});
