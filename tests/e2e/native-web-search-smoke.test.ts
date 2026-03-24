/**
 * End-to-end smoke test for provider-native web_search via Claude Code Max auth.
 *
 * Uses a REAL Claude Code Max model through Claude Code OAuth and proves:
 *   1. HLVM exposes the native web_search capability to the model
 *   2. The real model can answer a current-information query through live web search
 *   3. HLVM surfaces provider-native grounding as provider citations on the final response
 *   4. The custom local search_web tool is not used on the native Claude path
 *
 * Requirements:
 *   - Claude Code Max subscription (run `claude login` first)
 *   - Network access
 *   - Run with: deno test --allow-all tests/e2e/native-web-search-smoke.test.ts
 */

import { assert, assertEquals } from "jsr:@std/assert";
import {
  disposeAllSessions,
  runAgentQuery,
} from "../../src/hlvm/agent/agent-runner.ts";
import type { AgentUIEvent } from "../../src/hlvm/agent/orchestrator.ts";
import { resetHlvmDirCacheForTests } from "../../src/common/paths.ts";
import { getPlatform } from "../../src/platform/platform.ts";

const MODEL_CANDIDATES = [
  "claude-code/claude-opus-4-6",
  "claude-code/claude-sonnet-4-5-20250929",
  "claude-code/claude-haiku-4-5-20251001",
] as const;
const TIMEOUT_MS = 120_000;
const platform = getPlatform();

type SmokeRunResult = Awaited<ReturnType<typeof runAgentQuery>>;

async function runWithCompatibleClaudeModel(options: {
  query: string;
  workspace: string;
  signal: AbortSignal;
  callbacks: {
    onAgentEvent: (event: AgentUIEvent) => void;
  };
}): Promise<{ model: string; result: SmokeRunResult }> {
  let lastError: unknown;

  for (const model of MODEL_CANDIDATES) {
    try {
      const result = await runAgentQuery({
        query: options.query,
        model,
        workspace: options.workspace,
        permissionMode: "bypassPermissions",
        toolAllowlist: ["web_search"],
        disablePersistentMemory: true,
        signal: options.signal,
        callbacks: options.callbacks,
      });
      return { model, result };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const isSubscriptionGate = message.includes(
        "current subscription",
      ) || message.includes("not available with your current subscription");
      if (!isSubscriptionGate) {
        throw error;
      }
      lastError = error;
    }
  }

  throw lastError ?? new Error("No compatible Claude Code model was available");
}

async function withIsolatedEnv(
  fn: (workspace: string) => Promise<void>,
): Promise<void> {
  const hlvmDir = await platform.fs.makeTempDir({
    prefix: "hlvm-native-web-e2e-env-",
  });
  const workspace = await platform.fs.makeTempDir({
    prefix: "hlvm-native-web-e2e-ws-",
  });
  const originalHlvmDir = platform.env.get("HLVM_DIR");

  platform.env.set("HLVM_DIR", hlvmDir);
  resetHlvmDirCacheForTests();

  try {
    await fn(workspace);
  } finally {
    if (originalHlvmDir) {
      platform.env.set("HLVM_DIR", originalHlvmDir);
    } else {
      platform.env.delete("HLVM_DIR");
    }
    resetHlvmDirCacheForTests();

    for (const dir of [workspace, hlvmDir]) {
      try {
        await platform.fs.remove(dir, { recursive: true });
      } catch {
        // Best-effort temp cleanup only.
      }
    }
  }
}

Deno.test({
  name:
    "E2E real LLM: Claude Code uses native web_search and returns provider-grounded citations",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

    try {
      await withIsolatedEnv(async (workspace) => {
        const events: AgentUIEvent[] = [];

        const { model, result } = await runWithCompatibleClaudeModel({
          query:
            "Use live web search right now to find the latest post on the official Deno blog. Reply with the post title and the exact source URL. Do not answer from memory.",
          workspace,
          signal: controller.signal,
          callbacks: {
            onAgentEvent: (event) => events.push(event),
          },
        });

        assert(
          MODEL_CANDIDATES.some((candidate) => candidate === model),
          `Expected a Claude Code Max model candidate, got ${model}`,
        );

        const localSearchEvents = events.filter((event) =>
          (event.type === "tool_start" || event.type === "tool_end") &&
          event.name === "search_web"
        );
        assertEquals(
          localSearchEvents.length,
          0,
          `Claude native web path must not execute the local search_web tool. Events: ${
            events
              .filter((event) =>
                event.type === "tool_start" || event.type === "tool_end"
              )
              .map((event) =>
                `${event.type}:${
                  event.type === "tool_start" || event.type === "tool_end"
                    ? event.name
                    : "?"
                }`
              )
              .join(", ")
          }`,
        );

        assert(
          result.text.trim().length > 20,
          `Expected a grounded response, got: "${result.text.slice(0, 120)}"`,
        );

        const citations = result.finalResponseMeta?.citationSpans ?? [];
        assert(
          citations.length > 0,
          `Expected provider-grounded citations, got none. Response: ${
            result.text.slice(0, 200)
          }`,
        );

        const providerCitations = citations.filter((citation) =>
          citation.provenance === "provider"
        );
        assert(
          providerCitations.length > 0,
          `Expected at least one provider-native citation, got: ${
            JSON.stringify(citations, null, 2)
          }`,
        );
        assert(
          providerCitations.some((citation) => citation.url.startsWith("http")),
          `Expected provider citation URLs, got: ${
            JSON.stringify(providerCitations, null, 2)
          }`,
        );
        assert(
          providerCitations.some((citation) =>
            citation.title.trim().length > 0
          ),
          `Expected citation titles, got: ${
            JSON.stringify(providerCitations, null, 2)
          }`,
        );
      });
    } finally {
      clearTimeout(timeout);
      await disposeAllSessions();
    }
  },
});
