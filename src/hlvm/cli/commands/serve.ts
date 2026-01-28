/**
 * Serve Command - Start HTTP REPL Server
 * Provides HTTP API for REPL evaluation (replaces stdin/stdout)
 */

import { log } from "../../api/log.ts";
import { startHttpServer } from "../repl/http-server.ts";
import { initializeRuntime } from "../../../common/runtime-initializer.ts";

/**
 * Start HTTP REPL server
 */
export async function serveCommand(args: string[]): Promise<number> {
  if (args.includes("--help") || args.includes("-h")) {
    showServeHelp();
    return 0;
  }

  // Initialize runtime (stdlib + cache, no AI autostart)
  await initializeRuntime({ ai: false, stdlib: true, cache: true });

  try {
    await startHttpServer();
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
  POST /eval      Evaluate HQL code
  GET  /health    Health check

DESCRIPTION:
  Starts an HTTP server on port 11435 that provides a stateless
  REPL evaluation API. Used by HLVM GUI for code evaluation.

EXAMPLES:
  hlvm serve                                  # Start server
  curl http://localhost:11435/health          # Health check
  curl -X POST http://localhost:11435/eval \\
    -H "Content-Type: application/json" \\
    -d '{"code":"(+ 1 2)"}'                   # Evaluate code
`);
}
