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

/** Resolves when runtime is initialized; rejects permanently if all retries fail. */
let runtimeReady: Promise<void> | null = null;
let runtimeReadinessManaged = false;

/** Tracks runtime readiness state for /health endpoint */
export let runtimeReadyState: "pending" | "ready" | "failed" = "pending";

/** Whether serveCommand manages runtime readiness for this process. */
export function isRuntimeReadinessManaged(): boolean {
  return runtimeReadinessManaged;
}

/** Whether AI runtime should accept runtime-dependent requests right now. */
export function isRuntimeReadyForAiRequests(): boolean {
  return !runtimeReadinessManaged || runtimeReadyState === "ready";
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

    // Start server FIRST so the port is open immediately for GUI clients.
    // Deno.serve() binds the port synchronously — no "Connection refused" race.
    const serverDone = startHttpServer();

    // Initialize runtime in the background with retries.
    // The runtimeReady promise lets endpoints know when AI is available.
    runtimeReady = withRetry(
      async () => {
        await initializeRuntime({ ai: true, stdlib: true, cache: true });
        runtimeReadyState = "ready";
        // Notify connected SSE clients that models are now queryable.
        // This fixes a race where GUI connects before runtime is ready,
        // refreshModels() gets 503, and models stay empty forever.
        pushSSEEvent("__models__", "models_updated", { reason: "runtime_ready" });
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
