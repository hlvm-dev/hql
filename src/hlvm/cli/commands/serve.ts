/**
 * Serve Command - Start HLVM local runtime host
 * Provides the local HTTP/SSE/NDJSON shell boundary for GUI and CLI clients.
 */

import { log } from "../../api/log.ts";
import { startHttpServer } from "../repl/http-server.ts";
import { initializeRuntime } from "../../../common/runtime-initializer.ts";
import { hasHelpFlag } from "../utils/common-helpers.ts";
import { RuntimeError } from "../../../common/error.ts";
import { withRetry } from "../../../common/retry.ts";
import { pushSSEEvent } from "../../store/sse-store.ts";
import { verifyBootstrap } from "../../runtime/bootstrap-verify.ts";
import { recoverBootstrap } from "../../runtime/bootstrap-recovery.ts";
import { getPlatform } from "../../../platform/platform.ts";
import { resolveLocalFallbackModelId } from "../../runtime/local-fallback.ts";
import { getLocalModelDisplayName } from "../../runtime/local-llm.ts";
import { http } from "../../../common/http-client.ts";
import { DEFAULT_OLLAMA_ENDPOINT } from "../../../common/config/types.ts";
import { channelRuntime } from "../../channels/registry.ts";
import { aiEngine, shutdownManagedAIRuntime } from "../../runtime/ai-runtime.ts";

/** Resolves when runtime is initialized; rejects permanently if all retries fail. */
let runtimeReady: Promise<void> | null = null;
let runtimeReadinessManaged = false;

/** Tracks runtime readiness state for /health endpoint */
export let runtimeReadyState: "pending" | "ready" | "failed" = "pending";

/** Whether the bootstrap substrate has been verified. */
let bootstrapVerified = false;
let localFallbackReady = false;
let runtimeAiReadyReason: string | null = "AI runtime is still initializing.";
let runtimeAiReadyRetryable = true;
let runtimeServeStartedAt = 0;
let runtimeAiRecovery: Promise<boolean> | null = null;

function emitModelsReadyEvent(): void {
  pushSSEEvent("__models__", "models_updated", { reason: "runtime_ready" });
}

function setRuntimeAiReadyState(
  reason: string | null,
  retryable = true,
): void {
  runtimeAiReadyReason = reason;
  runtimeAiReadyRetryable = retryable;
}

/** Whether serveCommand manages runtime readiness for this process. */
export function isRuntimeReadinessManaged(): boolean {
  return runtimeReadinessManaged;
}

/** Whether AI runtime should accept runtime-dependent requests right now. */
export function isRuntimeReadyForAiRequests(): boolean {
  return !runtimeReadinessManaged ||
    (runtimeReadyState === "ready" && bootstrapVerified && localFallbackReady);
}

export function getRuntimeAiReadyReason(): string | null {
  return isRuntimeReadyForAiRequests() ? null : runtimeAiReadyReason;
}

export function isRuntimeAiReadyRetryable(): boolean {
  return !isRuntimeReadyForAiRequests() && runtimeAiReadyRetryable;
}

export function getRuntimeHostUptimeMs(): number | null {
  return runtimeServeStartedAt > 0
    ? Math.max(0, Date.now() - runtimeServeStartedAt)
    : null;
}

export function markRuntimeAiRequestSucceeded(): void {
  if (!runtimeReadinessManaged || runtimeReadyState !== "ready" || !bootstrapVerified) {
    return;
  }
  localFallbackReady = true;
  setRuntimeAiReadyState(null);
}

export function markRuntimeAiRequestFailed(
  reason: string,
  retryable: boolean,
): void {
  if (!runtimeReadinessManaged || !bootstrapVerified) {
    return;
  }
  localFallbackReady = false;
  setRuntimeAiReadyState(reason, retryable);
}

function shouldRecoverRuntimeAiOnDemand(): boolean {
  return runtimeReadinessManaged &&
    runtimeReadyState === "ready" &&
    bootstrapVerified &&
    !localFallbackReady &&
    (runtimeAiReadyReason?.includes("runtime request failed:") ?? false);
}

async function recoverRuntimeAiOnDemand(): Promise<boolean> {
  if (!shouldRecoverRuntimeAiOnDemand()) {
    return isRuntimeReadyForAiRequests();
  }

  try {
    log.warn?.(
      `Attempting one-shot recovery of the local ${getLocalModelDisplayName()} runtime after a request failure.`,
    );
    const restarted = await aiEngine.ensureRunning();
    if (!restarted) {
      setRuntimeAiReadyState(
        `Local ${getLocalModelDisplayName()} runtime could not be restarted.`,
        false,
      );
      return false;
    }
    localFallbackReady = await ensureLocalFallbackReady();
    emitModelsReadyIfReady();
    return isRuntimeReadyForAiRequests();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    setRuntimeAiReadyState(
      `Local ${getLocalModelDisplayName()} runtime recovery failed: ${message}`,
      false,
    );
    return false;
  }
}

export async function maybeRecoverRuntimeAiIfNeeded(): Promise<boolean> {
  if (!shouldRecoverRuntimeAiOnDemand()) {
    return isRuntimeReadyForAiRequests();
  }
  if (!runtimeAiRecovery) {
    runtimeAiRecovery = recoverRuntimeAiOnDemand().finally(() => {
      runtimeAiRecovery = null;
    });
  }
  return await runtimeAiRecovery;
}

export function __resetRuntimeAiStateForTesting(): void {
  runtimeReady = null;
  runtimeReadinessManaged = false;
  runtimeReadyState = "pending";
  bootstrapVerified = false;
  localFallbackReady = false;
  runtimeAiReadyReason = "AI runtime is still initializing.";
  runtimeAiReadyRetryable = true;
  runtimeServeStartedAt = 0;
  runtimeAiRecovery = null;
}

export function __setRuntimeAiStateForTesting(state: {
  readinessManaged?: boolean;
  readyState?: "pending" | "ready" | "failed";
  bootstrapReady?: boolean;
  localFallbackReady?: boolean;
  aiReadyReason?: string | null;
  aiReadyRetryable?: boolean;
}): void {
  if (state.readinessManaged !== undefined) {
    runtimeReadinessManaged = state.readinessManaged;
  }
  if (state.readyState !== undefined) {
    runtimeReadyState = state.readyState;
  }
  if (state.bootstrapReady !== undefined) {
    bootstrapVerified = state.bootstrapReady;
  }
  if (state.localFallbackReady !== undefined) {
    localFallbackReady = state.localFallbackReady;
  }
  if (state.aiReadyReason !== undefined) {
    runtimeAiReadyReason = state.aiReadyReason;
  }
  if (state.aiReadyRetryable !== undefined) {
    runtimeAiReadyRetryable = state.aiReadyRetryable;
  }
}

async function ensureLocalFallbackReady(): Promise<boolean> {
  const fallbackModelId = await resolveLocalFallbackModelId();
  const bareName = fallbackModelId.replace(/^ollama\//, "");
  const probe = await probeLocalFallbackPresence(bareName);

  if (probe.present) {
    setRuntimeAiReadyState(null);
    return true;
  }

  const reason = probe.reason;
  setRuntimeAiReadyState(
    `Local ${getLocalModelDisplayName()} fallback (${fallbackModelId}) is not ready for AI requests: ${reason}`,
    probe.retryable,
  );
  log.warn?.(
    `Local ${getLocalModelDisplayName()} fallback (${fallbackModelId}) is not ready for requests yet: ${reason}`,
  );
  return false;
}

interface LocalFallbackProbe {
  present: boolean;
  reason: string;
  retryable: boolean;
}

async function probeLocalFallbackPresence(
  modelName: string,
): Promise<LocalFallbackProbe> {
  try {
    return await fetchAndMatchTags(modelName);
  } catch (err) {
    return {
      present: false,
      reason: err instanceof Error ? err.message : String(err),
      retryable: false,
    };
  }
}

async function fetchAndMatchTags(
  modelName: string,
): Promise<LocalFallbackProbe> {
  const response = await http.fetchRaw(
    `${DEFAULT_OLLAMA_ENDPOINT}/api/tags`,
    { timeout: 2_000 },
  );
  if (!response.ok) {
    await response.body?.cancel();
    return {
      present: false,
      reason: `AI engine returned HTTP ${response.status} on /api/tags`,
      retryable: false,
    };
  }
  const payload = await response.json().catch(() => null) as {
    models?: Array<{ name?: unknown; model?: unknown }>;
  } | null;
  const served = new Set<string>();
  for (const entry of payload?.models ?? []) {
    if (typeof entry?.name === "string") served.add(entry.name);
    if (typeof entry?.model === "string") served.add(entry.model);
  }
  if (served.has(modelName)) {
    return { present: true, reason: "", retryable: true };
  }
  return {
    present: false,
    reason: `model '${modelName}' is not in the AI engine's model list`,
    retryable: false,
  };
}

function emitModelsReadyIfReady(): void {
  if (bootstrapVerified && localFallbackReady) {
    setRuntimeAiReadyState(null);
    emitModelsReadyEvent();
  }
}

/** Returns the runtime readiness promise. Endpoints can await this before using AI. */
export function getRuntimeReady(): Promise<void> {
  if (!runtimeReadinessManaged) {
    return Promise.resolve();
  }
  if (!runtimeReady) {
    return Promise.reject(new RuntimeError("Server not started"));
  }
  return runtimeReady;
}

/**
 * Start HTTP REPL server
 */
export async function serveCommand(args: string[]): Promise<number> {
  if (hasHelpFlag(args)) {
    showServeHelp();
    return 0;
  }

  try {
    let serverStarted = false;
    runtimeReadinessManaged = true;
    runtimeServeStartedAt = Date.now();
    runtimeReadyState = "pending";
    bootstrapVerified = false;
    localFallbackReady = false;
    setRuntimeAiReadyState("AI runtime is still initializing.", true);

    // Start server FIRST so the port is open immediately for GUI clients.
    // Deno.serve() binds the port synchronously — no "Connection refused" race.
    const serverDone = startHttpServer();
    serverStarted = true;

    // Initialize runtime in the background with retries.
    // The runtimeReady promise lets endpoints know when AI is available.
    runtimeReady = withRetry(
      async () => {
        await initializeRuntime({ ai: true, stdlib: true, cache: true });

        // Verify bootstrap substrate (engine + fallback model)
        const verification = await verifyBootstrap();
        if (verification.state === "verified") {
          bootstrapVerified = true;
          localFallbackReady = await ensureLocalFallbackReady();
        } else if (verification.state === "degraded") {
          // Bootstrap exists but is broken — attempt recovery.
          // bootstrapVerified stays false until recovery actually succeeds.
          setRuntimeAiReadyState(
            "Bootstrap verification is degraded. Recovery is in progress.",
            true,
          );
          recoverBootstrap(verification.manifest, verification).then(async (r) => {
            if (r.success) {
              bootstrapVerified = true;
              // Bootstrap reclaimed and killed production ollama while
              // materializing. Restart it before probing for fallback
              // readiness, else the probe sees Connection refused.
              await aiEngine.ensureRunning();
              localFallbackReady = await ensureLocalFallbackReady();
              log.info?.("Bootstrap recovery completed.");
              emitModelsReadyIfReady();
            } else {
              setRuntimeAiReadyState(
                `Bootstrap recovery failed: ${r.message}. Run 'hlvm bootstrap --repair' to fix.`,
                false,
              );
              log.warn?.(`Bootstrap recovery failed: ${r.message}. ` +
                `Run 'hlvm bootstrap --repair' to fix.`);
            }
          }).catch((err) => {
            setRuntimeAiReadyState(
              `Bootstrap recovery error: ${(err as Error).message}`,
              false,
            );
            log.warn?.(`Bootstrap recovery error: ${(err as Error).message}`);
          });
        } else {
          // Uninitialized — no manifest exists. Check if this build has an
          // embedded engine. Compiled HLVM binaries must fail closed here:
          // uninitialized bootstrap means local AI is not ready.
          //
          // Source-mode `deno run` development builds are the only bypass case.
          try {
            const execName = getPlatform().path.basename(
              getPlatform().process.execPath(),
            ).toLowerCase();
            const isDenoDrivenDevBuild = execName.includes("deno");
            if (isDenoDrivenDevBuild) {
              bootstrapVerified = true;
              localFallbackReady = true;
              setRuntimeAiReadyState(null);
            } else {
              const {
                extractAIEngine,
                resolveEmbeddedEnginePath,
              } = await import("../../runtime/ai-runtime.ts");
              await extractAIEngine();
              const embeddedEnginePath = await resolveEmbeddedEnginePath();
              if (embeddedEnginePath) {
                setRuntimeAiReadyState(
                  "Verified bootstrap not found. Local AI bootstrap is being materialized.",
                  true,
                );
                log.info?.(
                  "Embedded engine found without a verified bootstrap. " +
                    `Starting ${getLocalModelDisplayName()}-first local AI bootstrap in the background...`,
                );
                recoverBootstrap(verification.manifest, verification).then(async (r) => {
                  if (r.success) {
                    bootstrapVerified = true;
                    // Bootstrap reclaimed and killed production ollama while
                    // materializing. Restart it before probing for fallback
                    // readiness, else the probe sees Connection refused.
                    await aiEngine.ensureRunning();
                    localFallbackReady = await ensureLocalFallbackReady();
                    log.info?.("Bootstrap materialization completed.");
                    emitModelsReadyIfReady();
                  } else {
                    setRuntimeAiReadyState(
                      `Bootstrap auto-setup failed: ${r.message}. Run 'hlvm bootstrap --repair' to retry.`,
                      false,
                    );
                    log.warn?.(`Bootstrap auto-setup failed: ${r.message}. ` +
                      `Run 'hlvm bootstrap --repair' to retry.`);
                  }
                }).catch((err) => {
                  setRuntimeAiReadyState(
                    `Bootstrap auto-setup error: ${(err as Error).message}`,
                    false,
                  );
                  log.warn?.(`Bootstrap auto-setup error: ${(err as Error).message}`);
                });
              } else {
                setRuntimeAiReadyState(
                  "Compiled HLVM build does not have a verified embedded AI runtime. Run 'hlvm bootstrap' after reinstalling the AI-enabled binary.",
                  false,
                );
                log.warn?.(
                  "Compiled HLVM build does not have a verified embedded AI runtime. " +
                  "Run 'hlvm bootstrap' after reinstalling the AI-enabled binary.",
                );
              }
            }
          } catch (error) {
            setRuntimeAiReadyState(
              `Failed to determine embedded engine status: ${
                error instanceof Error ? error.message : String(error)
              }`,
              false,
            );
            log.warn?.(`Failed to determine embedded engine status: ${
              error instanceof Error ? error.message : String(error)
            }`);
          }
        }

        runtimeReadyState = "ready";
        await channelRuntime.reconfigure();
        emitModelsReadyIfReady();
      },
      {
        maxAttempts: 3,
        initialDelayMs: 1000,
        backoffFactor: 1, // linear: 1s, 1s (matches original 1s * attempt pattern closely enough)
        onRetry: (error, attempt) => {
          log.error(`Runtime initialization attempt ${attempt}/3 failed`, error);
        },
      },
    ).catch((error) => {
      runtimeReadyState = "failed";
      const wrappedError = new RuntimeError(
        "Runtime initialization failed after retries; AI features unavailable.",
        {
          originalError: error instanceof Error ? error : undefined,
        },
      );
      setRuntimeAiReadyState(wrappedError.message, false);
      log.error(wrappedError.message, error);
      throw wrappedError;
    });

    try {
      await serverDone;
      return 0;
    } finally {
      await channelRuntime.stop();
      if (serverStarted) {
        await shutdownManagedAIRuntime().catch((error) => {
          log.warn("Failed to shut down managed AI runtime", error);
        });
      }
    }
  } catch (error) {
    log.error("Failed to start server", error);
    return 1;
  }
}

/**
 * Display serve command help
 */
export function showServeHelp(): void {
  log.raw.log(`
HLVM Serve - HTTP REPL Server

USAGE:
  hlvm serve

ENDPOINTS:
  POST /api/chat          Submit chat, eval, or agent turns
  GET  /api/chat/messages Read active conversation messages
  GET  /api/chat/stream   Subscribe to active conversation updates
  GET  /health            Health check

DESCRIPTION:
  Starts the local HLVM runtime host on port 11435.
  Used by GUI clients and host-backed CLI surfaces.
  GUI-visible top-level submission flows through POST /api/chat.
  Internal compatibility primitives remain available but are not part of the public contract.

EXAMPLES:
  hlvm serve                                  # Start server
  curl http://localhost:11435/health          # Health check
  curl -X POST http://localhost:11435/api/chat \\
    -H "Content-Type: application/json" \\
    -d '{"mode":"eval","messages":[{"role":"user","content":"(+ 1 2)"}]}'  # Evaluate HQL
  curl -X POST http://localhost:11435/api/chat \\
    -H "Content-Type: application/json" \\
    -d '{"mode":"chat","messages":[{"role":"user","content":"hello"}]}'    # Chat
`);
}
