import {
  assert,
  assertEquals,
  assertExists,
} from "jsr:@std/assert";
import { runAgentQuery } from "../../src/hlvm/agent/agent-runner.ts";
import type { AgentUIEvent, TraceEvent } from "../../src/hlvm/agent/orchestrator.ts";
import type { AgentExecutionMode } from "../../src/hlvm/agent/execution-mode.ts";
import type { ConversationAttachmentPayload } from "../../src/hlvm/attachments/types.ts";
import {
  runChatViaHost,
} from "../../src/hlvm/runtime/host-client.ts";
import type { ChatRequestMessage } from "../../src/hlvm/runtime/chat-protocol.ts";
import type { HostHealthResponse } from "../../src/hlvm/runtime/chat-protocol.ts";
import { resetHlvmDirCacheForTests } from "../../src/common/paths.ts";
import { getPlatform } from "../../src/platform/platform.ts";
import type { PlatformCommandProcess } from "../../src/platform/types.ts";
import {
  getHlvmRuntimeBaseUrl,
  HLVM_RUNTIME_PORT_SCAN_RANGE,
  resolveHlvmRuntimePort,
  setCachedRuntimeBaseUrl,
} from "../../src/hlvm/runtime/host-config.ts";
import { http } from "../../src/common/http-client.ts";
import {
  areRuntimeHostBuildIdsCompatible,
  buildRuntimeServeCommand,
  getRuntimeHostIdentity,
} from "../../src/hlvm/runtime/host-identity.ts";
import { withEnv } from "../shared/light-helpers.ts";
import { shutdownRuntimeHostIfPresent } from "../shared/runtime-host-test-helpers.ts";

const platform = getPlatform();
const RED_PIXEL_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAGUlEQVR42mP4z8DwnxLMMGrAqAGjBgwXAwAwxP4QisZM5QAAAABJRU5ErkJggg==";
const BLUE_PIXEL_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAGElEQVR42mNgYPj/nzI8asCoAaMGDBMDADKm/hANtY/hAAAAAElFTkSuQmCC";
const RUNTIME_HOST_START_POLL_ATTEMPTS = 240;
const RUNTIME_HOST_START_POLL_MS = 100;
let explicitlyStartedRuntimeBaseUrl: string | null = null;
let explicitlyStartedRuntimeProcess: PlatformCommandProcess | null = null;

export type SmokeRunResult = Awaited<ReturnType<typeof runAgentQuery>>;
export type HostSmokeRunResult = Awaited<ReturnType<typeof runChatViaHost>>;

async function readHealth(baseUrl: string): Promise<HostHealthResponse | null> {
  try {
    const response = await http.fetchRaw(`${baseUrl}/health`, { timeout: 500 });
    if (!response.ok) {
      await response.body?.cancel();
      return null;
    }
    return await response.json() as HostHealthResponse;
  } catch {
    return null;
  }
}

async function waitForCompatibleRuntimeHost(
  baseUrl: string,
  buildId: string,
  authToken?: string,
): Promise<boolean> {
  for (let i = 0; i < RUNTIME_HOST_START_POLL_ATTEMPTS; i++) {
    const health = await readHealth(baseUrl);
    if (
      health?.status === "ok" &&
      (!authToken || health.authToken === authToken) &&
      health.aiReady === true &&
      areRuntimeHostBuildIdsCompatible(buildId, health.buildId)
    ) {
      return true;
    }
    await new Promise((resolve) =>
      setTimeout(resolve, RUNTIME_HOST_START_POLL_MS)
    );
  }
  return false;
}

function canUseCompatibleRuntimeHost(
  health: HostHealthResponse | null,
  buildId: string,
): health is HostHealthResponse & {
  status: "ok";
  authToken: string;
  aiReady: true;
} {
  return health?.status === "ok" &&
    typeof health.authToken === "string" &&
    health.aiReady === true &&
    areRuntimeHostBuildIdsCompatible(buildId, health.buildId);
}

async function tryStartCompatibleRuntimeHost(
  port: number,
  buildId: string,
): Promise<string | null> {
  const baseUrl = `http://127.0.0.1:${port}`;
  const authToken = crypto.randomUUID();
  const env = {
    ...platform.env.toObject(),
    HLVM_AUTH_TOKEN: authToken,
    HLVM_RUNTIME_BUILD_ID: buildId,
    HLVM_REPL_PORT: String(port),
    DENO_V8_FLAGS: [
      platform.env.get("DENO_V8_FLAGS"),
      "--max-old-space-size=4096",
    ].filter(Boolean).join(","),
  };
  const process = platform.command.run({
    cmd: buildRuntimeServeCommand(),
    env,
    stdin: "null",
    stdout: "null",
    stderr: "null",
  });
  process.unref?.();

  const started = await waitForCompatibleRuntimeHost(
    baseUrl,
    buildId,
    authToken,
  );
  if (!started) {
    const attached = await readHealth(baseUrl);
    if (!canUseCompatibleRuntimeHost(attached, buildId)) {
      return null;
    }
  }

  explicitlyStartedRuntimeBaseUrl = baseUrl;
  explicitlyStartedRuntimeProcess = process;
  setCachedRuntimeBaseUrl(baseUrl);
  return baseUrl;
}

async function ensureExplicitRuntimeHostStarted(): Promise<void> {
  const port = resolveHlvmRuntimePort();
  const identity = await getRuntimeHostIdentity();
  const baseUrl = getHlvmRuntimeBaseUrl();
  const existing = await readHealth(baseUrl);
  if (canUseCompatibleRuntimeHost(existing, identity.buildId)) {
    return;
  }

  if (existing === null) {
    const startedBaseUrl = await tryStartCompatibleRuntimeHost(
      port,
      identity.buildId,
    );
    if (startedBaseUrl) return;
  }

  for (let offset = 1; offset <= HLVM_RUNTIME_PORT_SCAN_RANGE; offset++) {
    const candidatePort = port + offset;
    const candidateUrl = `http://127.0.0.1:${candidatePort}`;
    const health = await readHealth(candidateUrl);
    if (canUseCompatibleRuntimeHost(health, identity.buildId)) {
      setCachedRuntimeBaseUrl(candidateUrl);
      return;
    }
    if (health !== null) continue;
    const startedBaseUrl = await tryStartCompatibleRuntimeHost(
      candidatePort,
      identity.buildId,
    );
    if (startedBaseUrl) return;
  }

  throw new Error(
    "Failed to explicitly start a compatible runtime host for live smoke tests.",
  );
}

async function stopExplicitlyStartedRuntimeHost(): Promise<void> {
  const baseUrl = explicitlyStartedRuntimeBaseUrl;
  const process = explicitlyStartedRuntimeProcess;
  explicitlyStartedRuntimeBaseUrl = null;
  explicitlyStartedRuntimeProcess = null;

  if (process) {
    try {
      process.kill?.("SIGKILL");
    } catch {
      // Best-effort cleanup only.
    }
    return;
  }

  if (baseUrl) {
    const shutdown = shutdownRuntimeHostIfPresent(baseUrl);
    await Promise.race([
      shutdown,
      new Promise<void>((resolve) => setTimeout(resolve, 500)),
    ]);
  }
}

export async function runWithCompatibleModel(options: {
  models: readonly string[];
  query: string;
  workspace: string;
  signal: AbortSignal;
  toolAllowlist?: string[];
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

export async function runHostAgentWithCompatibleModel(options: {
  models: readonly string[];
  query?: string;
  messages?: ChatRequestMessage[];
  workspace: string;
  signal: AbortSignal;
  fixturePath?: string;
  maxTokens?: number;
  contextWindow?: number;
  stateless?: boolean;
  disablePersistentMemory?: boolean;
  permissionMode?: AgentExecutionMode;
  toolAllowlist?: string[];
  toolDenylist?: string[];
  callbacks: {
    onToken?: (text: string) => void;
    onAgentEvent?: (event: AgentUIEvent) => void;
    onTrace?: (event: TraceEvent) => void;
  };
}): Promise<{ model: string; result: HostSmokeRunResult }> {
  let lastError: unknown;
  const messages = options.messages ?? [{
    role: "user" as const,
    content: options.query ?? "",
  }];

  for (const model of options.models) {
    try {
      await ensureExplicitRuntimeHostStarted();
      const result = await runChatViaHost({
        mode: "agent",
        messages,
        model,
        fixturePath: options.fixturePath,
        maxTokens: options.maxTokens,
        contextWindow: options.contextWindow,
        stateless: options.stateless,
        permissionMode: options.permissionMode,
        disablePersistentMemory: options.disablePersistentMemory,
        toolAllowlist: options.toolAllowlist,
        toolDenylist: options.toolDenylist,
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
  const runtimePort = resolveHlvmRuntimePort();
  const runtimeBaseUrl = `http://127.0.0.1:${runtimePort}`;

  try {
    await withEnv("HLVM_DIR", hlvmDir, async () => {
      resetHlvmDirCacheForTests();
      explicitlyStartedRuntimeBaseUrl = null;
      explicitlyStartedRuntimeProcess = null;
      try {
        try {
          await fn(workspace);
        } finally {
          if (explicitlyStartedRuntimeBaseUrl || explicitlyStartedRuntimeProcess) {
            await stopExplicitlyStartedRuntimeHost();
          }
        }
      } finally {
        explicitlyStartedRuntimeBaseUrl = null;
        explicitlyStartedRuntimeProcess = null;
        resetHlvmDirCacheForTests();
      }
    });
  } finally {
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
