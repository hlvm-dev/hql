/**
 * HTTP REPL Server - Stateless HTTP API for REPL evaluation and agent queries
 * Replaces stdin/stdout transport with HTTP endpoints
 * SSOT: Thin wrapper around existing evaluation infrastructure
 */

import { evaluate } from "./evaluator.ts";
import { formatPlainValue } from "./formatter.ts";
import { initReplState } from "./init-repl-state.ts";
import { ReplState } from "./state.ts";
import { listMemoryFunctions, type MemoryFunctionItem } from "./memory.ts";
import { escapeString } from "./string-utils.ts";
import { log } from "../../api/log.ts";
import { getPlatform } from "../../../platform/platform.ts";
import { RuntimeError } from "../../../common/error.ts";
import { getErrorMessage } from "../../../common/utils.ts";
import { buildContext } from "../repl-ink/completion/providers.ts";
import { getActiveProvider } from "../repl-ink/completion/concrete-providers.ts";
import { ensureAgentReady, runAgentQuery } from "../../agent/agent-runner.ts";
import { DEFAULT_TOOL_DENYLIST } from "../../agent/constants.ts";

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
const MAX_BODY_BYTES = 1_000_000;
const platform = getPlatform();
const textDecoder = new TextDecoder();
const INSTANCE_ID = platform.env.get("HLVM_REPL_INSTANCE_ID") ?? null;

function resolvePort(): number {
  const portOverride = platform.env.get("HLVM_REPL_PORT");
  if (!portOverride) return DEFAULT_PORT;
  const parsed = parseInt(portOverride, 10);
  if (Number.isNaN(parsed) || parsed < 1 || parsed > 65535) {
    log.warn(`Invalid HLVM_REPL_PORT "${portOverride}", using default ${DEFAULT_PORT}`);
    return DEFAULT_PORT;
  }
  return parsed;
}

let replState: ReplState | null = null;

/**
 * Eval Request Schema
 * Matches the terminal REPL capabilities
 */
interface EvalRequest {
  code: string;
}

interface CompletionRequest {
  text: string;
  cursor: number;
}

interface MemoryFunctionsResponse {
  functions: MemoryFunctionItem[];
}

interface AskRequest {
  query: string;
  model?: string;
  workspace?: string;
}

interface MemoryExecuteRequest {
  functionName: string;
  args?: string[];
}

interface MemoryExecuteResponse {
  output: string;
  status: "success" | "error";
  error?: {
    message: string;
    code: string;
  };
}


type JsonParseResult<T> =
  | { ok: true; value: T }
  | { ok: false; response: Response };

function jsonError(message: string, status: number): Response {
  return Response.json({ error: message }, { status });
}

function addCorsHeaders(response: Response): Response {
  response.headers.set("Access-Control-Allow-Origin", "*");
  response.headers.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  response.headers.set("Access-Control-Allow-Headers", "Content-Type");
  return response;
}

async function readBodyWithLimit(req: Request, limit: number): Promise<
  { ok: true; bytes: Uint8Array } | { ok: false; response: Response }
> {
  if (!req.body) {
    return { ok: false, response: jsonError("Missing body", 400) };
  }

  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    if (!value) continue;
    total += value.byteLength;
    if (total > limit) {
      await reader.cancel();
      return { ok: false, response: jsonError("Request too large", 413) };
    }
    chunks.push(value);
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return { ok: true, bytes };
}

async function parseJsonBody<T>(req: Request): Promise<JsonParseResult<T>> {
  const contentType = req.headers.get("content-type");
  if (contentType && !contentType.includes("application/json")) {
    return { ok: false, response: jsonError("Content-Type must be application/json", 400) };
  }

  const contentLength = req.headers.get("content-length");
  if (contentLength) {
    const length = Number.parseInt(contentLength, 10);
    if (Number.isFinite(length) && length > MAX_BODY_BYTES) {
      return { ok: false, response: jsonError("Request too large", 413) };
    }
  }

  const bodyResult = await readBodyWithLimit(req, MAX_BODY_BYTES);
  if (!bodyResult.ok) return bodyResult;
  if (bodyResult.bytes.length === 0) {
    return { ok: false, response: jsonError("Missing body", 400) };
  }

  try {
    const text = textDecoder.decode(bodyResult.bytes);
    return { ok: true, value: JSON.parse(text) as T };
  } catch {
    return { ok: false, response: jsonError("Invalid JSON", 400) };
  }
}

/**
 * Initialize REPL state using shared SSOT initializer
 */
async function initState(): Promise<ReplState> {
  const initResult = await initReplState({
    memoryJsMode: false,
  });
  const state = initResult.state;
  const moduleResult = initResult.moduleResult;

  if (moduleResult) {
    log.info(
      `Loaded ${moduleResult.stdlibExports.length} stdlib + ` +
      `${moduleResult.aiExports.length} AI functions`
    );

    if (moduleResult.errors.length > 0) {
      log.warn(`Module load errors: ${moduleResult.errors.join(", ")}`);
    }
  }

  log.info(`REPL state initialized: ${state.getDocstrings().size} definitions`);
  return state;
}

/**
 * Handle POST /eval - Evaluate HQL code
 */
async function handleEval(req: Request): Promise<Response> {
  try {
    const parsed = await parseJsonBody<EvalRequest>(req);
    if (!parsed.ok) return parsed.response;

    const { code } = parsed.value;
    if (typeof code !== "string" || code.length === 0) {
      return jsonError("Missing code", 400);
    }

    // Lazy initialize state on first request
    if (!replState) {
      replState = await initState();
    }

    const result = await evaluate(code, replState, true);
    const hasValue = Object.prototype.hasOwnProperty.call(result, "value");

    return Response.json({
      success: result.success,
      value: hasValue ? formatPlainValue(result.value) : null,  // Plain text, no ANSI codes
      logs: result.logs?.map((log) => log.trimEnd()) ?? [],
      error: result.error
        ? { name: result.error.name, message: result.error.message }
        : null,
    });
  } catch (error) {
    log.error("Eval failed", error);
    return jsonError(getErrorMessage(error), 500);
  }
}

/**
 * Handle POST /complete - Get completion suggestions
 */
async function handleComplete(req: Request): Promise<Response> {
  try {
    const parsed = await parseJsonBody<CompletionRequest>(req);
    if (!parsed.ok) return parsed.response;

    const { text, cursor } = parsed.value;
    if (typeof text !== "string") {
      return jsonError("Missing text", 400);
    }
    if (typeof cursor !== "number" || Number.isNaN(cursor)) {
      return jsonError("Missing cursor", 400);
    }

    // Lazy initialize state on first request
    if (!replState) {
      replState = await initState();
    }

    const safeCursor = Math.max(0, Math.min(cursor, text.length));
    const memoryApi = (globalThis as Record<string, unknown>).memory as {
      list: () => Promise<string[]>;
    } | undefined;
    const memoryNames = memoryApi?.list ? new Set(await memoryApi.list()) : new Set();

    const context = buildContext(
      text,
      safeCursor,
      replState.getBindingsSet(),
      replState.getSignatures(),
      replState.getDocstrings(),
      memoryNames
    );

    const provider = getActiveProvider(context);
    if (!provider) {
      return Response.json({
        items: [],
        anchor: context.wordStart,
        providerId: null,
        helpText: null
      });
    }

    const result = await provider.getCompletions(context);
    const items = result.items.map((item) => {
      const render = item.getRenderSpec();
      return {
        label: item.label,
        type: item.type,
        description: render.description ?? item.description ?? null,
        detail: render.typeLabel ?? null,
        documentation: render.extendedDoc ?? null,
        score: item.score,
        matchIndices: item.matchIndices ?? []
      };
    });

    return Response.json({
      items,
      anchor: result.anchor,
      providerId: provider.id,
      helpText: provider.helpText ?? null
    });
  } catch (error) {
    log.error("Completion failed", error);
    return jsonError(getErrorMessage(error), 500);
  }
}

/**
 * Handle GET /health - Health check endpoint
 */
function handleHealth(): Response {
  return Response.json({
    status: "ok",
    initialized: replState !== null,
    definitions: replState?.getDocstrings().size ?? 0,
    instanceId: INSTANCE_ID,
  });
}

function encodeHqlString(value: string): string {
  return `"${escapeString(value)}"`;
}

function buildExecuteCode(definition: MemoryFunctionItem, args: string[]): string {
  if (definition.kind === "def") {
    return `(do ${definition.name})`;
  }
  const encodedArgs = args.map((arg) => encodeHqlString(arg));
  const argList = encodedArgs.length > 0 ? ` ${encodedArgs.join(" ")}` : "";
  return `(${definition.name}${argList})`;
}

async function handleMemoryFunctions(): Promise<Response> {
  try {
    const functions = await listMemoryFunctions();
    const payload: MemoryFunctionsResponse = { functions };
    return Response.json(payload);
  } catch (error) {
    log.error("Memory functions list failed", error);
    return jsonError(getErrorMessage(error), 500);
  }
}

function execError(message: string, code: string): Response {
  return Response.json({ output: "", status: "error", error: { message, code } } satisfies MemoryExecuteResponse);
}

async function handleMemoryExecute(req: Request): Promise<Response> {
  try {
    const parsed = await parseJsonBody<MemoryExecuteRequest>(req);
    if (!parsed.ok) return parsed.response;

    const { functionName, args = [] } = parsed.value;
    if (typeof functionName !== "string" || functionName.length === 0) {
      return jsonError("Missing functionName", 400);
    }
    if (!Array.isArray(args) || !args.every((arg) => typeof arg === "string")) {
      return jsonError("args must be an array of strings", 400);
    }

    const definitions = await listMemoryFunctions();
    const definition = definitions.find((def) => def.name === functionName);
    if (!definition) {
      return execError(`Function '${functionName}' not found`, "FUNCTION_NOT_FOUND");
    }

    if (definition.kind === "defn" && args.length !== definition.arity) {
      return execError(`Arity mismatch: expected ${definition.arity} args, got ${args.length}`, "ARITY_MISMATCH");
    }
    if (definition.kind === "def" && args.length !== 0) {
      return execError("def values do not accept arguments", "ARITY_MISMATCH");
    }

    if (!replState) {
      replState = await initState();
    }

    const code = buildExecuteCode(definition, args);
    const result = await evaluate(code, replState, false);
    if (!result.success) {
      return execError(result.error?.message ?? "Execution failed", "EXECUTION_ERROR");
    }

    const hasValue = Object.prototype.hasOwnProperty.call(result, "value");
    const output = hasValue ? formatPlainValue(result.value) : "";
    return Response.json({ output, status: "success" } satisfies MemoryExecuteResponse);
  } catch (error) {
    log.error("Memory execute failed", error);
    return jsonError(getErrorMessage(error), 500);
  }
}

let agentReady = false;

/**
 * Handle POST /api/ask - Run agent query with NDJSON streaming
 *
 * Uses the shared agent runner (SSOT) with NDJSON callbacks.
 * Each line is a JSON object: {"event":"token","text":"..."}\n
 * The ask_user tool is disabled (noInput: true) since there is no stdin.
 */
function handleAsk(req: Request): Response {
  const encoder = new TextEncoder();

  function ndjsonLine(obj: unknown): Uint8Array {
    return encoder.encode(JSON.stringify(obj) + "\n");
  }

  const stream = new ReadableStream({
    async start(controller) {
      let parsed: JsonParseResult<AskRequest>;
      try {
        parsed = await parseJsonBody<AskRequest>(req);
      } catch {
        controller.enqueue(ndjsonLine({ event: "error", message: "Invalid request" }));
        controller.close();
        return;
      }
      if (!parsed.ok) {
        controller.enqueue(ndjsonLine({ event: "error", message: "Invalid JSON body" }));
        controller.close();
        return;
      }

      const { query, model, workspace } = parsed.value;
      if (typeof query !== "string" || query.length === 0) {
        controller.enqueue(ndjsonLine({ event: "error", message: "Missing query" }));
        controller.close();
        return;
      }

      try {
        if (!agentReady) {
          const resolvedModel = model ?? (await import("../../../common/ai-default-model.ts")).getConfiguredModel();
          await ensureAgentReady(resolvedModel, (msg) => log.info(msg));
          agentReady = true;
        }

        const result = await runAgentQuery({
          query,
          model,
          workspace,
          autoApprove: true,
          noInput: true,
          toolDenylist: [...DEFAULT_TOOL_DENYLIST, "ask_user"],
          callbacks: {
            onToken: (text) => {
              controller.enqueue(ndjsonLine({ event: "token", text }));
            },
            onToolDisplay: (event) => {
              controller.enqueue(ndjsonLine({
                event: "tool",
                name: event.toolName,
                success: event.success,
                content: event.content,
              }));
            },
          },
        });

        controller.enqueue(ndjsonLine({
          event: "complete",
          text: result.text,
          stats: result.stats,
        }));
      } catch (error) {
        controller.enqueue(ndjsonLine({
          event: "error",
          message: getErrorMessage(error),
        }));
      }

      controller.close();
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      "Content-Type": "application/x-ndjson",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    },
  });
}

/**
 * Main request router
 */
async function handleRequest(req: Request): Promise<Response> {
  const url = new URL(req.url);

  log.debug(`${req.method} ${url.pathname}`);

  if (req.method === "OPTIONS") {
    return addCorsHeaders(new Response(null, { status: 204 }));
  }

  if (req.method === "POST" && url.pathname === "/eval") {
    return addCorsHeaders(await handleEval(req));
  }

  if (req.method === "POST" && url.pathname === "/complete") {
    return addCorsHeaders(await handleComplete(req));
  }

  if (req.method === "GET" && url.pathname === "/health") {
    return addCorsHeaders(handleHealth());
  }

  if (req.method === "GET" && url.pathname === "/api/memory/functions") {
    return addCorsHeaders(await handleMemoryFunctions());
  }

  if (req.method === "POST" && url.pathname === "/api/memory/functions/execute") {
    return addCorsHeaders(await handleMemoryExecute(req));
  }

  if (req.method === "POST" && url.pathname === "/api/ask") {
    return handleAsk(req);
  }

  return addCorsHeaders(jsonError("Not found", 404));
}

/**
 * Start HTTP REPL server
 */
export async function startHttpServer(): Promise<void> {
  const port = resolvePort();
  try {
    log.info(`Starting REPL HTTP server on port ${port}...`);
    await platform.http.serve(handleRequest, {
      port,
      onListen: ({ hostname, port }) => {
        log.info(`REPL HTTP server listening on http://${hostname}:${port}`);
      },
    });
  } catch (error) {
    // Handle port in use error
    if (error instanceof Error && error.name === "AddrInUse") {
      log.error(
        `Port ${port} is already in use. Another HLVM instance may be running.`,
      );
      throw new RuntimeError(
        `REPL server port ${port} is already in use`,
      );
    }
    log.error(`Failed to start REPL HTTP server: ${getErrorMessage(error)}`);
    throw error;
  }
}
