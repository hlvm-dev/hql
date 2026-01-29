/**
 * HTTP REPL Server - Stateless HTTP API for REPL evaluation
 * Replaces stdin/stdout transport with HTTP endpoints
 * SSOT: Thin wrapper around existing evaluation infrastructure
 */

import { evaluate } from "./evaluator.ts";
import { formatPlainValue } from "./formatter.ts";
import { ReplState } from "./state.ts";
import { registerApis } from "../../api/index.ts";
import { registerReplHelpers } from "./helpers.ts";
import { memory } from "../../api/memory.ts";
import { config } from "../../api/config.ts";
import { log } from "../../api/log.ts";
import { getPlatform } from "../../../platform/platform.ts";
import { RuntimeError } from "../../../common/error.ts";
import { getErrorMessage } from "../../../common/utils.ts";

/**
 * REPL HTTP Server Port
 *
 * CRITICAL SSOT: Default port (11435) MUST match Swift's ReplHttpClient.
 * Located at: HLVM/REPL/Infrastructure/ReplHttpClient.swift
 *
 * Contract: Port 11435 is the standard HLVM REPL HTTP endpoint.
 * - TypeScript server listens on this port
 * - Swift client connects to this port
 * - Port chosen to avoid conflict with Ollama (11434)
 * - Can be overridden via HLVM_REPL_PORT environment variable (for testing)
 */
const DEFAULT_PORT = 11435;
const platform = getPlatform();
const portOverride = platform.env.get("HLVM_REPL_PORT");
const PORT = portOverride
  ? parseInt(portOverride, 10)
  : DEFAULT_PORT;

let replState: ReplState | null = null;

/**
 * Initialize REPL state (same logic as headless.ts)
 * Loads memory, registers APIs, and prepares evaluation context
 */
async function initState(): Promise<ReplState> {
  const state = new ReplState();

  try {
    await config.reload();
  } catch {
    // Ignore config load failures; defaults will be used
  }

  await state.initHistory();

  registerApis({
    replState: state,
    runtime: {
      getDocstrings: () => state.getDocstrings(),
      getSignatures: () => state.getSignatures(),
    },
  });

  // Load memory (same as headless.ts)
  try {
    await memory.compact();
    state.setLoadingMemory(true);
    const result = await memory.load(async (code: string) => {
      const evalResult = await evaluate(code, state, false);
      return { success: evalResult.success, error: evalResult.error };
    });
    state.setLoadingMemory(false);
    if (result.docstrings.size > 0) {
      state.addDocstrings(result.docstrings);
    }
  } catch {
    state.setLoadingMemory(false);
  }

  registerReplHelpers(state);

  log.info(`REPL state initialized: ${state.getDocstrings().size} definitions`);
  return state;
}

/**
 * Handle POST /eval - Evaluate HQL code
 */
async function handleEval(req: Request): Promise<Response> {
  try {
    const { code } = await req.json();
    if (!code) {
      return Response.json({ error: "Missing code" }, { status: 400 });
    }

    // Lazy initialize state on first request
    if (!replState) {
      replState = await initState();
    }

    const result = await evaluate(code, replState, false);
    const hasValue = Object.prototype.hasOwnProperty.call(result, "value");

    return Response.json({
      success: result.success,
      value: hasValue ? formatPlainValue(result.value) : null,  // Plain text, no ANSI codes
      error: result.error
        ? { name: result.error.name, message: result.error.message }
        : null,
    });
  } catch (error) {
    log.error("Eval failed", error);
    return Response.json({ error: error.message }, { status: 500 });
  }
}

/**
 * Handle GET /health - Health check endpoint
 */
async function handleHealth(): Promise<Response> {
  return Response.json({
    status: "ok",
    initialized: replState !== null,
    definitions: replState?.getDocstrings().size ?? 0,
  });
}

/**
 * Main request router
 */
async function handleRequest(req: Request): Promise<Response> {
  const url = new URL(req.url);

  if (req.method === "POST" && url.pathname === "/eval") {
    return await handleEval(req);
  }

  if (req.method === "GET" && url.pathname === "/health") {
    return await handleHealth();
  }

  return Response.json({ error: "Not found" }, { status: 404 });
}

/**
 * Start HTTP REPL server
 */
export async function startHttpServer(): Promise<void> {
  try {
    log.info(`Starting REPL HTTP server on port ${PORT}...`);
    await platform.http.serve(handleRequest, {
      port: PORT,
      onListen: ({ hostname, port }) => {
        log.info(`REPL HTTP server listening on http://${hostname}:${port}`);
      },
    });
  } catch (error) {
    // Handle port in use error
    if (error instanceof Error && error.name === "AddrInUse") {
      log.error(
        `Port ${PORT} is already in use. Another HLVM instance may be running.`,
      );
      throw new RuntimeError(
        `REPL server port ${PORT} is already in use`,
      );
    }
    log.error(`Failed to start REPL HTTP server: ${getErrorMessage(error)}`);
    throw error;
  }
}
