/**
 * Serve Command - Start HTTP REPL Server
 * Provides HTTP API for REPL evaluation (replaces stdin/stdout)
 */

import { log } from "../../api/log.ts";
import { startHttpServer } from "../repl/http-server.ts";
import { initializeRuntime } from "../../../common/runtime-initializer.ts";
import { hasHelpFlag } from "../utils/common-helpers.ts";
import { RuntimeError } from "../../../common/error.ts";
import { withRetry } from "../../../common/retry.ts";

/** Resolves when runtime is initialized; rejects permanently if all retries fail. */
let runtimeReady: Promise<void> | null = null;

/** Tracks runtime readiness state for /health endpoint */
export let runtimeReadyState: "pending" | "ready" | "failed" = "pending";

/** Returns the runtime readiness promise. Endpoints can await this before using AI. */
export function getRuntimeReady(): Promise<void> {
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
    // Start server FIRST so the port is open immediately for GUI clients.
    // Deno.serve() binds the port synchronously — no "Connection refused" race.
    const serverDone = startHttpServer();

    // Initialize runtime in the background with retries.
    // The runtimeReady promise lets endpoints know when AI is available.
    runtimeReady = withRetry(
      async () => {
        await initializeRuntime({ ai: true, stdlib: true, cache: true });
        runtimeReadyState = "ready";
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
      log.error("Runtime initialization failed after retries; AI features unavailable.", error);
      throw error;
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
  POST /eval      Evaluate HQL or JavaScript code (polyglot)
  GET  /health    Health check

DESCRIPTION:
  Starts an HTTP server on port 11435 that provides a stateless
  REPL evaluation API. Used by HLVM GUI for code evaluation.
  Polyglot mode is always enabled: input starting with '(' is HQL,
  all other input is JavaScript.

EXAMPLES:
  hlvm serve                                  # Start server
  curl http://localhost:11435/health          # Health check
  curl -X POST http://localhost:11435/eval \\
    -H "Content-Type: application/json" \\
    -d '{"code":"(+ 1 2)"}'                   # Evaluate HQL
  curl -X POST http://localhost:11435/eval \\
    -H "Content-Type: application/json" \\
    -d '{"code":"let a = 10"}'                # Evaluate JavaScript
`);
}
