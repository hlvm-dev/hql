/**
 * HTTP REPL Server - Stateless HTTP API for REPL evaluation
 * Replaces stdin/stdout transport with HTTP endpoints
 * SSOT: Thin wrapper around existing evaluation infrastructure
 */

import { evaluate } from "./evaluator.ts";
import { formatPlainValue } from "./formatter.ts";
import { initReplState } from "./init-repl-state.ts";
import { ReplState } from "./state.ts";
import { log } from "../../api/log.ts";
import { getPlatform } from "../../../platform/platform.ts";
import { RuntimeError } from "../../../common/error.ts";
import { getErrorMessage } from "../../../common/utils.ts";
import { buildContext } from "../repl-ink/completion/providers.ts";
import { getActiveProvider } from "../repl-ink/completion/concrete-providers.ts";
import {
  selectHqlForm,
  splitTopLevelHqlForms,
  type HqlRange,
} from "../../../common/hql-selection.ts";
import { parse } from "../../../hql/transpiler/pipeline/parser.ts";

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

function resolvePort(): number {
  const portOverride = platform.env.get("HLVM_REPL_PORT");
  return portOverride ? parseInt(portOverride, 10) : DEFAULT_PORT;
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

interface SelectRequest {
  code: string;
  cursor: number;
}

interface SplitRequest {
  code: string;
}

type JsonParseResult<T> =
  | { ok: true; value: T }
  | { ok: false; response: Response };

function jsonError(message: string, status: number): Response {
  return Response.json({ error: message }, { status });
}

function isValidHqlSnippet(code: string): boolean {
  const trimmed = code.trim();
  if (!trimmed) return false;
  try {
    const ast = parse(trimmed, "<repl-selection>");
    return Array.isArray(ast) && ast.length > 0;
  } catch {
    return false;
  }
}

function selectHqlRange(code: string, cursor: number): HqlRange | null {
  const ranges = splitTopLevelHqlForms(code);
  if (ranges.length === 0) return null;

  for (const range of ranges) {
    const slice = code.slice(range.start, range.end);
    if (!isValidHqlSnippet(slice)) continue;
    if (cursor >= range.start && cursor <= range.end) {
      return range;
    }
  }

  return null;
}

function splitHqlRanges(code: string): HqlRange[] {
  const ranges = splitTopLevelHqlForms(code);
  if (ranges.length === 0) return [];
  return ranges.filter((range) => isValidHqlSnippet(code.slice(range.start, range.end)));
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
 * Handle POST /repl/selection - Select a top-level HQL form containing the cursor
 */
async function handleSelect(req: Request): Promise<Response> {
  try {
    const parsed = await parseJsonBody<SelectRequest>(req);
    if (!parsed.ok) return parsed.response;

    const { code, cursor } = parsed.value;
    if (typeof code !== "string") {
      return jsonError("Missing code", 400);
    }
    if (typeof cursor !== "number" || Number.isNaN(cursor)) {
      return jsonError("Missing cursor", 400);
    }

    const safeCursor = Math.max(0, Math.min(cursor, code.length));
    const range = selectHqlRange(code, safeCursor) ??
      (() => {
        const candidate = selectHqlForm(code, safeCursor);
        if (!candidate) return null;
        const slice = code.slice(candidate.start, candidate.end);
        return isValidHqlSnippet(slice) ? candidate : null;
      })();

    return Response.json({ range });
  } catch (error) {
    log.error("Select failed", error);
    return jsonError(getErrorMessage(error), 500);
  }
}

/**
 * Handle POST /repl/blocks - Split top-level HQL forms for a snippet
 */
async function handleSplit(req: Request): Promise<Response> {
  try {
    const parsed = await parseJsonBody<SplitRequest>(req);
    if (!parsed.ok) return parsed.response;

    const { code } = parsed.value;
    if (typeof code !== "string") {
      return jsonError("Missing code", 400);
    }

    const ranges: HqlRange[] = splitHqlRanges(code);
    return Response.json({ ranges });
  } catch (error) {
    log.error("Split failed", error);
    return jsonError(getErrorMessage(error), 500);
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

  if (req.method === "POST" && url.pathname === "/repl/selection") {
    return addCorsHeaders(await handleSelect(req));
  }

  if (req.method === "POST" && url.pathname === "/repl/blocks") {
    return addCorsHeaders(await handleSplit(req));
  }

  if (req.method === "GET" && url.pathname === "/health") {
    return addCorsHeaders(await handleHealth());
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
