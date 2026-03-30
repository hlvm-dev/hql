import {
  assert,
  assertEquals,
  assertExists,
} from "jsr:@std/assert";
import { runAgentQuery } from "../../src/hlvm/agent/agent-runner.ts";
import type { AgentUIEvent } from "../../src/hlvm/agent/orchestrator.ts";
import type { ConversationAttachmentPayload } from "../../src/hlvm/attachments/types.ts";
import type { RuntimeMode } from "../../src/hlvm/agent/runtime-mode.ts";
import { resetHlvmDirCacheForTests } from "../../src/common/paths.ts";
import { getPlatform } from "../../src/platform/platform.ts";

const platform = getPlatform();
const RED_PIXEL_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAGUlEQVR42mP4z8DwnxLMMGrAqAGjBgwXAwAwxP4QisZM5QAAAABJRU5ErkJggg==";
const BLUE_PIXEL_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAGElEQVR42mNgYPj/nzI8asCoAaMGDBMDADKm/hANtY/hAAAAAElFTkSuQmCC";

export type SmokeRunResult = Awaited<ReturnType<typeof runAgentQuery>>;
export type RoutedEvent = Extract<AgentUIEvent, { type: "capability_routed" }>;

export async function runWithCompatibleModel(options: {
  models: readonly string[];
  query: string;
  workspace: string;
  signal: AbortSignal;
  toolAllowlist?: string[];
  runtimeMode?: RuntimeMode;
  attachments?: ConversationAttachmentPayload[];
  responseSchema?: Record<string, unknown>;
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
        permissionMode: "bypassPermissions",
        toolAllowlist: options.toolAllowlist,
        runtimeMode: options.runtimeMode,
        attachments: options.attachments,
        responseSchema: options.responseSchema,
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

export function getCapabilityRouteEvents(events: AgentUIEvent[]): RoutedEvent[] {
  return events.filter((event) =>
    event.type === "capability_routed"
  );
}

export function summarizeCapabilityRouteSequence(
  events: AgentUIEvent[],
): string[] {
  return getCapabilityRouteEvents(events).map((event) =>
    `${event.routePhase}:${event.capabilityId}`
  );
}

export function assertCapabilityRouteSequence(
  events: AgentUIEvent[],
  expected: string[],
): void {
  assertEquals(summarizeCapabilityRouteSequence(events), expected);
}

export function assertCapabilityRoute(
  events: AgentUIEvent[],
  options: {
    capabilityId: string;
    routePhase: RoutedEvent["routePhase"];
    selectedBackendKind?: RoutedEvent["selectedBackendKind"];
  },
): RoutedEvent {
  const routed = getCapabilityRouteEvents(events).find((event) =>
    event.capabilityId === options.capabilityId &&
    event.routePhase === options.routePhase
  );
  assertExists(
    routed,
    `Expected capability_routed for ${options.routePhase}:${options.capabilityId}`,
  );
  assertEquals(routed.selectedBackendKind, options.selectedBackendKind);
  return routed;
}

export function makeInlineImageAttachment(
  color: "red" | "blue" = "red",
): ConversationAttachmentPayload {
  return {
    mode: "binary",
    attachmentId: `att-${color}-pixel`,
    fileName: `${color}-pixel.png`,
    mimeType: "image/png",
    kind: "image",
    conversationKind: "image",
    size: color === "red" ? 82 : 81,
    data: color === "red" ? RED_PIXEL_PNG_BASE64 : BLUE_PIXEL_PNG_BASE64,
  };
}

export function assertStructuredResult(
  result: SmokeRunResult,
  requiredKeys: string[],
): Record<string, unknown> {
  assertExists(
    result.structuredResult,
    "Expected structuredResult to be present for structured-output turn",
  );
  assert(
    typeof result.structuredResult === "object" &&
      result.structuredResult !== null &&
      !Array.isArray(result.structuredResult),
    `Expected structuredResult object, got ${typeof result.structuredResult}`,
  );
  const obj = result.structuredResult as Record<string, unknown>;
  for (const key of requiredKeys) {
    assertExists(obj[key], `Expected structuredResult.${key} to be defined`);
  }
  return obj;
}

export function hasEnvVar(name: string): boolean {
  const value = platform.env.get(name);
  return typeof value === "string" && value.trim().length > 0;
}
