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

/** Resolves when runtime is initialized; rejects permanently if all retries fail. */
let runtimeReady: Promise<void> | null = null;
let runtimeReadinessManaged = false;

/** Tracks runtime readiness state for /health endpoint */
export let runtimeReadyState: "pending" | "ready" | "failed" = "pending";

/** Whether the bootstrap substrate has been verified. */
let bootstrapVerified = false;

function emitModelsReadyEvent(): void {
  pushSSEEvent("__models__", "models_updated", { reason: "runtime_ready" });
}

/** Whether serveCommand manages runtime readiness for this process. */
export function isRuntimeReadinessManaged(): boolean {
  return runtimeReadinessManaged;
}

/** Whether AI runtime should accept runtime-dependent requests right now. */
export function isRuntimeReadyForAiRequests(): boolean {
  return !runtimeReadinessManaged || (runtimeReadyState === "ready" && bootstrapVerified);
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
    runtimeReadinessManaged = true;
    runtimeReadyState = "pending";
    bootstrapVerified = false;

    // Start server FIRST so the port is open immediately for GUI clients.
    // Deno.serve() binds the port synchronously — no "Connection refused" race.
    const serverDone = startHttpServer();

    // Initialize runtime in the background with retries.
    // The runtimeReady promise lets endpoints know when AI is available.
    runtimeReady = withRetry(
      async () => {
        await initializeRuntime({ ai: true, stdlib: true, cache: true });

        // Verify bootstrap substrate (engine + fallback model)
        const verification = await verifyBootstrap();
        if (verification.state === "verified") {
          bootstrapVerified = true;
        } else if (verification.state === "degraded") {
          // Bootstrap exists but is broken — attempt recovery.
          // bootstrapVerified stays false until recovery actually succeeds.
          recoverBootstrap(verification.manifest, verification).then((r) => {
            if (r.success) {
              bootstrapVerified = true;
              log.info?.("Bootstrap recovery completed.");
              emitModelsReadyEvent();
            } else {
              log.warn?.(`Bootstrap recovery failed: ${r.message}. ` +
                `Run 'hlvm bootstrap --repair' to fix.`);
            }
          }).catch((err) => {
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
            } else {
              const {
                extractAIEngine,
                resolveEmbeddedEnginePath,
              } = await import("../../runtime/ai-runtime.ts");
              await extractAIEngine();
              const embeddedEnginePath = await resolveEmbeddedEnginePath();
              if (embeddedEnginePath) {
                log.warn?.("Embedded engine found but bootstrap not run. " +
                  "Run 'hlvm bootstrap' to set up local AI.");
              } else {
                log.warn?.(
                  "Compiled HLVM build does not have a verified embedded AI runtime. " +
                  "Run 'hlvm bootstrap' after reinstalling the AI-enabled binary.",
                );
              }
            }
          } catch (error) {
            log.warn?.(`Failed to determine embedded engine status: ${
              error instanceof Error ? error.message : String(error)
            }`);
          }
        }

        runtimeReadyState = "ready";
        if (bootstrapVerified) {
          emitModelsReadyEvent();
        }
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
      log.error(wrappedError.message, error);
      throw wrappedError;
    });

    await serverDone;
    return 0;
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
