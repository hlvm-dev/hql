import { assert, assertEquals } from "jsr:@std/assert";
import { runAgentQuery } from "../../src/hlvm/agent/agent-runner.ts";
import type { AgentUIEvent } from "../../src/hlvm/agent/orchestrator.ts";
import { resetHlvmDirCacheForTests } from "../../src/common/paths.ts";
import { getPlatform } from "../../src/platform/platform.ts";

const platform = getPlatform();

export type SmokeRunResult = Awaited<ReturnType<typeof runAgentQuery>>;

export async function runWithCompatibleModel(options: {
  models: readonly string[];
  query: string;
  workspace: string;
  signal: AbortSignal;
  toolAllowlist: string[];
  callbacks: {
    onAgentEvent: (event: AgentUIEvent) => void;
  };
}): Promise<{ model: string; result: SmokeRunResult }> {
  let lastError: unknown;

  for (const model of options.models) {
    try {
      const result = await runAgentQuery({
        query: options.query,
        model,
        workspace: options.workspace,
        permissionMode: "yolo",
        toolAllowlist: options.toolAllowlist,
        disablePersistentMemory: true,
        signal: options.signal,
        callbacks: options.callbacks,
      });
      return { model, result };
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError ?? new Error("No compatible model was available");
}

export async function withIsolatedEnv(
  fn: (workspace: string) => Promise<void>,
): Promise<void> {
  const hlvmDir = await platform.fs.makeTempDir({
    prefix: "hlvm-native-provider-e2e-env-",
  });
  const workspace = await platform.fs.makeTempDir({
    prefix: "hlvm-native-provider-e2e-ws-",
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

export function assertNoLocalToolEvents(
  events: AgentUIEvent[],
  toolName: string,
): void {
  const localEvents = events.filter((event) =>
    (event.type === "tool_start" || event.type === "tool_end") &&
    event.name === toolName
  );
  assertEquals(
    localEvents.length,
    0,
    `Expected no local ${toolName} execution, got events: ${
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
}

export function assertHasProviderCitations(result: SmokeRunResult): void {
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
}

export function hasEnvVar(name: string): boolean {
  const value = platform.env.get(name);
  return typeof value === "string" && value.trim().length > 0;
}
