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
import { parseJsonBody, jsonError, addCorsHeaders } from "./http-utils.ts";
import { createRouter } from "./http-router.ts";
import { handleChat, handleChatCancel, handleSessionCancel } from "./handlers/chat.ts";
import {
  handleListSessions,
  handleCreateSession,
  handleGetSession,
  handleUpdateSession,
  handleDeleteSession,
  handleDeleteAllSessions,
  handleSessionsStream,
} from "./handlers/sessions.ts";
import {
  handleGetMessages,
  handleGetMessage,
  handleAddMessage,
  handleUpdateMessage,
  handleDeleteMessage,
} from "./handlers/messages.ts";
import {
  handleListModels,
  handleGetModel,
  handlePullModel,
  handleDeleteModel,
  handleModelStatus,
  handleModelCatalog,
  handleModelsStream,
} from "./handlers/models.ts";
import { handleSSEStream } from "./handlers/sse.ts";
import { handleGetConfig, handlePatchConfig, handleConfigStream } from "./handlers/config.ts";

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
const INSTANCE_ID = platform.env.get("HLVM_REPL_INSTANCE_ID") ?? null;

/** Auth token generated on server start — clients must send `Authorization: Bearer <token>` */
let serverAuthToken: string | null = null;

/** Get the current server auth token (for tests or UI client bootstrap) */
export function getServerAuthToken(): string | null {
  return serverAuthToken;
}

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

// MARK: - Types

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

// MARK: - REPL State

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

// MARK: - Legacy Handlers

/**
 * @openapi
 * /eval:
 *   post:
 *     tags: [REPL]
 *     summary: Evaluate HQL code
 *     operationId: evalCode
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               code:
 *                 type: string
 *             required: [code]
 *     responses:
 *       '200':
 *         description: Evaluation result.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 value:
 *                   type: string
 *                   nullable: true
 *                 logs:
 *                   type: array
 *                   items:
 *                     type: string
 *                 error:
 *                   type: object
 *                   nullable: true
 *                   properties:
 *                     name:
 *                       type: string
 *                     message:
 *                       type: string
 *       '400':
 *         description: Missing code.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       '500':
 *         description: Evaluation error.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
async function handleEval(req: Request): Promise<Response> {
  try {
    const parsed = await parseJsonBody<EvalRequest>(req);
    if (!parsed.ok) return parsed.response;

    const { code } = parsed.value;
    if (typeof code !== "string" || code.length === 0) {
      return jsonError("Missing code", 400);
    }

    if (!replState) {
      replState = await initState();
    }

    const result = await evaluate(code, replState, true);
    const hasValue = Object.prototype.hasOwnProperty.call(result, "value");

    return Response.json({
      success: result.success,
      value: hasValue ? formatPlainValue(result.value) : null,
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
 * @openapi
 * /api/completions:
 *   post:
 *     tags: [REPL]
 *     summary: Get code completions
 *     operationId: completions
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               text:
 *                 type: string
 *               cursor:
 *                 type: integer
 *             required: [text, cursor]
 *     responses:
 *       '200':
 *         description: Completion items.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 items:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       label:
 *                         type: string
 *                       type:
 *                         type: string
 *                       description:
 *                         type: string
 *                         nullable: true
 *                       detail:
 *                         type: string
 *                         nullable: true
 *                       documentation:
 *                         type: string
 *                         nullable: true
 *                       score:
 *                         type: number
 *                       matchIndices:
 *                         type: array
 *                         items:
 *                           type: integer
 *                 anchor:
 *                   type: integer
 *                 providerId:
 *                   type: string
 *                   nullable: true
 *                 helpText:
 *                   type: string
 *                   nullable: true
 *       '400':
 *         description: Missing text or cursor.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       '500':
 *         description: Completion error.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
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

    if (!replState) {
      replState = await initState();
    }

    const safeCursor = Math.max(0, Math.min(cursor, text.length));
    const memoryApi = (globalThis as Record<string, unknown>).memory as {
      list: () => Promise<string[]>;
    } | undefined;
    const memoryNames: ReadonlySet<string> = memoryApi?.list ? new Set(await memoryApi.list()) : new Set<string>();

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
 * @openapi
 * /health:
 *   get:
 *     tags: [REPL]
 *     summary: Health check (no auth required)
 *     operationId: healthCheck
 *     security: []
 *     responses:
 *       '200':
 *         description: Server status.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status:
 *                   type: string
 *                   enum: [ok]
 *                 initialized:
 *                   type: boolean
 *                 definitions:
 *                   type: integer
 *                 instanceId:
 *                   type: string
 *                   nullable: true
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

/**
 * @openapi
 * /api/memory/functions:
 *   get:
 *     tags: [Memory]
 *     summary: List available HQL memory functions
 *     operationId: listMemoryFunctions
 *     responses:
 *       '200':
 *         description: Array of memory functions.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 functions:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/MemoryFunction'
 *       '500':
 *         description: Failed to list functions.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
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

/**
 * @openapi
 * /api/memory/functions/execute:
 *   post:
 *     tags: [Memory]
 *     summary: Execute an HQL memory function
 *     operationId: executeMemoryFunction
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               functionName:
 *                 type: string
 *               args:
 *                 type: array
 *                 items:
 *                   type: string
 *                 default: []
 *             required: [functionName]
 *     responses:
 *       '200':
 *         description: Execution result.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 output:
 *                   type: string
 *                 status:
 *                   type: string
 *                   enum: [success, error]
 *                 error:
 *                   type: object
 *                   nullable: true
 *                   properties:
 *                     message:
 *                       type: string
 *                     code:
 *                       type: string
 *       '400':
 *         description: Missing functionName or invalid args.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       '500':
 *         description: Execution failure.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
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

// MARK: - Router Setup

const router = createRouter();

router.add("POST", "/api/chat", (req) => handleChat(req));
router.add("POST", "/api/chat/cancel", (req) => handleChatCancel(req));

router.add("GET", "/api/sessions", () => handleListSessions());
router.add("POST", "/api/sessions", (req) => handleCreateSession(req));
router.add("DELETE", "/api/sessions", () => handleDeleteAllSessions());
router.add("GET", "/api/sessions/stream", (req) => handleSessionsStream(req));
router.add("GET", "/api/sessions/:id", (req, p) => handleGetSession(req, p));
router.add("PATCH", "/api/sessions/:id", (req, p) => handleUpdateSession(req, p));
router.add("DELETE", "/api/sessions/:id", (req, p) => handleDeleteSession(req, p));
router.add("POST", "/api/sessions/:id/cancel", (_req, p) => handleSessionCancel(p.id));

router.add("GET", "/api/sessions/:id/messages", (req, p) => handleGetMessages(req, p));
router.add("POST", "/api/sessions/:id/messages", (req, p) => handleAddMessage(req, p));
router.add("GET", "/api/sessions/:id/messages/:messageId", (req, p) => handleGetMessage(req, p));
router.add("PATCH", "/api/sessions/:id/messages/:messageId", (req, p) => handleUpdateMessage(req, p));
router.add("DELETE", "/api/sessions/:id/messages/:messageId", (req, p) => handleDeleteMessage(req, p));
router.add("GET", "/api/sessions/:id/stream", (req, p) => handleSSEStream(req, p));

router.add("GET", "/api/models", () => handleListModels());
router.add("GET", "/api/models/catalog", () => handleModelCatalog());
router.add("GET", "/api/models/status", () => handleModelStatus());
router.add("GET", "/api/models/:provider/:name", (req, p) => handleGetModel(req, p));
router.add("POST", "/api/models/pull", (req) => handlePullModel(req));
router.add("DELETE", "/api/models/:provider/:name", (req, p) => handleDeleteModel(req, p));
router.add("GET", "/api/models/stream", (req) => handleModelsStream(req));

router.add("POST", "/api/completions", (req) => handleComplete(req));

router.add("GET", "/api/config", () => handleGetConfig());
router.add("PATCH", "/api/config", (req) => handlePatchConfig(req));
router.add("GET", "/api/config/stream", (req) => handleConfigStream(req));

// MARK: - Request Handler

async function handleRequest(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const origin = req.headers.get("Origin") ?? "";

  log.debug(`${req.method} ${url.pathname}`);

  // CORS preflight and health check bypass auth
  if (req.method === "OPTIONS") {
    return addCorsHeaders(new Response(null, { status: 204 }), origin);
  }

  if (req.method === "GET" && url.pathname === "/health") {
    return addCorsHeaders(handleHealth(), origin);
  }

  // Auth check: require Bearer token for all other routes
  if (serverAuthToken) {
    const authHeader = req.headers.get("Authorization") ?? "";
    if (authHeader !== `Bearer ${serverAuthToken}`) {
      return addCorsHeaders(jsonError("Unauthorized", 401), origin);
    }
  }

  if (req.method === "POST" && url.pathname === "/eval") {
    return addCorsHeaders(await handleEval(req), origin);
  }

  if (req.method === "POST" && url.pathname === "/complete") {
    return addCorsHeaders(await handleComplete(req), origin);
  }

  if (req.method === "GET" && url.pathname === "/api/memory/functions") {
    return addCorsHeaders(await handleMemoryFunctions(), origin);
  }

  if (req.method === "POST" && url.pathname === "/api/memory/functions/execute") {
    return addCorsHeaders(await handleMemoryExecute(req), origin);
  }

  const match = router.match(req.method, url.pathname);
  if (match) {
    const response = await match.handler(req, match.params);
    return addCorsHeaders(response, origin);
  }

  return addCorsHeaders(jsonError("Not found", 404), origin);
}

// MARK: - Server

export interface StartHttpServerOptions {
  port?: number;
}

export async function startHttpServer(options: StartHttpServerOptions = {}): Promise<void> {
  const port = options.port ?? resolvePort();

  // Use pre-shared token from env (GUI passes this) or generate a random one
  serverAuthToken = getPlatform().env.get("HLVM_AUTH_TOKEN") || crypto.randomUUID();
  log.info(`REPL auth token: ${serverAuthToken}`);

  try {
    log.info(`Starting REPL HTTP server on port ${port}...`);
    await platform.http.serve(handleRequest, {
      port,
      hostname: "127.0.0.1",
      onListen: ({ hostname, port }) => {
        log.info(`REPL HTTP server listening on http://${hostname}:${port}`);
      },
    });
  } catch (error) {
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
