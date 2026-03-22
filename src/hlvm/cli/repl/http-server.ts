/**
 * HLVM Runtime Host - local HTTP/SSE/NDJSON boundary for shells.
 * Exposes REPL evaluation, agent execution, sessions, models, config, and companion APIs.
 * SSOT: Thin wrapper around shared runtime services and evaluation infrastructure.
 */

import { delay } from "@std/async";
import { evaluate } from "./evaluator.ts";
import { formatPlainValue } from "./formatter.ts";
import { initReplState } from "./init-repl-state.ts";
import { ReplState } from "./state.ts";
import { type BindingFunctionItem, listBindingFunctions } from "./bindings.ts";
import { escapeString } from "./string-utils.ts";
import { log } from "../../api/log.ts";
import { getPlatform } from "../../../platform/platform.ts";
import type { PlatformHttpServerHandle } from "../../../platform/types.ts";
import { RuntimeError } from "../../../common/error.ts";
import { getErrorMessage } from "../../../common/utils.ts";
import { buildContext } from "../repl-ink/completion/providers.ts";
import { getActiveProvider } from "../repl-ink/completion/concrete-providers.ts";
import { addCorsHeaders, jsonError, parseJsonBody } from "./http-utils.ts";
import { createRouter } from "./http-router.ts";
import {
  handleChat,
  handleChatCancel,
  handleChatInteraction,
} from "./handlers/chat.ts";
import {
  getRuntimeReady,
  isRuntimeReadinessManaged,
  isRuntimeReadyForAiRequests,
  runtimeReadyState,
} from "../commands/serve.ts";
import {
  handleAddActiveMessage,
  handleDeleteActiveMessage,
  handleGetActiveMessage,
  handleGetActiveMessages,
  handleUpdateActiveMessage,
} from "./handlers/messages.ts";
import { closeActiveConversationSession } from "../../store/active-conversation.ts";
import {
  handleDeleteModel,
  handleGetModel,
  handleListInstalledModels,
  handleListModels,
  handleModelCatalog,
  handleModelDiscovery,
  handleModelsStream,
  handleModelStatus,
  handlePullModel,
  handleVerifyModelAccess,
} from "./handlers/models.ts";
import { handleActiveConversationStream } from "./handlers/sse.ts";
import {
  handleConfigStream,
  handleGetConfig,
  handlePatchConfig,
  handleReloadConfig,
  handleResetConfig,
} from "./handlers/config.ts";
import {
  handleGetAttachment,
  handleGetAttachmentContent,
  handleRegisterAttachment,
  handleUploadAttachment,
} from "./handlers/attachments.ts";
import { getAttachmentRecords } from "../../attachments/service.ts";
import {
  handleAddMcpServer,
  handleListMcpServers,
  handleLoginMcpServer,
  handleLogoutMcpServer,
  handleRemoveMcpServer,
} from "./handlers/mcp.ts";
import { handleOllamaSignin } from "./handlers/providers.ts";
import {
  handleCompanionConfig,
  handleCompanionObserve,
  handleCompanionRespond,
  handleCompanionStatus,
  handleCompanionStream,
} from "./handlers/companion.ts";
import {
  HLVM_RUNTIME_DEFAULT_PORT,
  resolveHlvmRuntimePort,
} from "../../runtime/host-config.ts";
import { getRuntimeHostIdentity } from "../../runtime/host-identity.ts";
import { normalizeComparableFilePath } from "./file-search.ts";

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
const AI_READY_WAIT_MS = 150;
const platform = getPlatform();

/** Auth token generated on server start — clients must send `Authorization: Bearer <token>` */
let serverAuthToken: string | null = null;
let serverHandle: PlatformHttpServerHandle | null = null;

function resolvePort(): number {
  const port = resolveHlvmRuntimePort();
  const override = platform.env.get("HLVM_REPL_PORT");
  if (
    override && port === HLVM_RUNTIME_DEFAULT_PORT &&
    override !== String(HLVM_RUNTIME_DEFAULT_PORT)
  ) {
    log.warn(
      `Invalid HLVM_REPL_PORT "${override}", using default ${HLVM_RUNTIME_DEFAULT_PORT}`,
    );
  }
  return port;
}

let replState: ReplState | null = null;

// MARK: - Types

interface CompletionRequest {
  text: string;
  cursor: number;
  attachment_ids?: string[];
  attachment_paths?: string[];
}

interface BindingFunctionsResponse {
  functions: BindingFunctionItem[];
}

interface BindingExecuteRequest {
  functionName: string;
  args?: string[];
}

interface EvalRequest {
  code: string;
}

interface BindingExecuteResponse {
  output: string;
  status: "success" | "error";
  error?: {
    message: string;
    code: string;
  };
}

// MARK: - REPL State

async function initState(): Promise<ReplState> {
  const initResult = await initReplState({});
  const state = initResult.state;
  const moduleResult = initResult.moduleResult;

  if (moduleResult) {
    log.info(
      `Loaded ${moduleResult.stdlibExports.length} stdlib + ` +
        `${moduleResult.aiExports.length} AI functions`,
    );

    if (moduleResult.errors.length > 0) {
      log.warn(`Module load errors: ${moduleResult.errors.join(", ")}`);
    }
  }

  log.info(`REPL state initialized: ${state.getDocstrings().size} definitions`);
  return state;
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
 *               attachment_ids:
 *                 type: array
 *                 items:
 *                   type: string
 *               attachment_paths:
 *                 type: array
 *                 items:
 *                   type: string
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
async function resolveCompletionAttachedPaths(
  request: CompletionRequest,
): Promise<ReadonlySet<string> | undefined> {
  const attachedPaths = new Set<string>();

  for (const path of request.attachment_paths ?? []) {
    if (typeof path === "string" && path.trim().length > 0) {
      attachedPaths.add(normalizeComparableFilePath(path));
    }
  }

  const attachmentIds = (request.attachment_ids ?? []).filter((id) =>
    typeof id === "string" && id.trim().length > 0
  );
  if (attachmentIds.length > 0) {
    const records = await getAttachmentRecords(attachmentIds);
    for (const record of records) {
      if (record.sourcePath) {
        attachedPaths.add(normalizeComparableFilePath(record.sourcePath));
      }
    }
  }

  return attachedPaths.size > 0 ? attachedPaths : undefined;
}

export async function handleComplete(req: Request): Promise<Response> {
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
    const bindingsApi = (globalThis as Record<string, unknown>).bindings as {
      list: () => Promise<string[]>;
    } | undefined;
    const bindingNames: ReadonlySet<string> = bindingsApi?.list
      ? new Set(await bindingsApi.list())
      : new Set<string>();
    const attachedPaths = await resolveCompletionAttachedPaths(parsed.value);

    const context = buildContext(
      text,
      safeCursor,
      replState.getBindingsSet(),
      replState.getSignatures(),
      replState.getDocstrings(),
      bindingNames,
      attachedPaths,
    );

    const provider = getActiveProvider(context);
    if (!provider) {
      return Response.json({
        items: [],
        anchor: context.wordStart,
        providerId: null,
        helpText: null,
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
        matchIndices: item.matchIndices ?? [],
      };
    });

    return Response.json({
      items,
      anchor: result.anchor,
      providerId: provider.id,
      helpText: provider.helpText ?? null,
    });
  } catch (error) {
    log.error("Completion failed", error);
    return jsonError(getErrorMessage(error), 500);
  }
}

export async function handleEval(req: Request): Promise<Response> {
  try {
    const parsed = await parseJsonBody<EvalRequest>(req);
    if (!parsed.ok) return parsed.response;

    const { code } = parsed.value;
    if (typeof code !== "string") {
      return jsonError("Missing code", 400);
    }

    if (!replState) {
      replState = await initState();
    }

    const result = await evaluate(code, replState);
    if (result.success) {
      const hasValue = Object.prototype.hasOwnProperty.call(result, "value");
      return Response.json({
        success: true,
        value: hasValue ? formatPlainValue(result.value) : "",
        error: null,
      });
    }

    return Response.json({
      success: false,
      error: {
        name: result.error?.name ?? "Error",
        message: result.error?.message ?? "Execution failed",
      },
    });
  } catch (error) {
    const err = error instanceof Error ? error : new Error(getErrorMessage(error));
    return Response.json({
      success: false,
      error: {
        name: err.name,
        message: err.message,
      },
    });
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
 *                 aiReady:
 *                   type: boolean
 *                 version:
 *                   type: string
 *                 buildId:
 *                   type: string
 *                 authToken:
 *                   type: string
 *                   description: Bearer token the server uses for authenticated endpoints
 */
async function handleHealth(): Promise<Response> {
  const identity = await getRuntimeHostIdentity();
  return Response.json({
    status: "ok",
    initialized: replState !== null,
    definitions: replState?.getDocstrings().size ?? 0,
    aiReady: isRuntimeReadyForAiRequests(),
    version: identity.version,
    buildId: identity.buildId,
    authToken: serverAuthToken,
  });
}

function scheduleServerShutdown(): void {
  const activeHandle = serverHandle;
  if (!activeHandle) return;
  setTimeout(() => {
    void activeHandle.shutdown().catch((error) => {
      log.warn("Failed to shut down REPL HTTP server", error);
    });
  }, 0);
}

async function handleRuntimeShutdown(): Promise<Response> {
  replState = null;
  await closeActiveConversationSession();
  scheduleServerShutdown();
  return Response.json({ ok: true, shutting_down: true });
}

function requiresAiRuntime(method: string, pathname: string): boolean {
  if (method === "POST" && pathname === "/api/chat") {
    return true;
  }
  if (!pathname.startsWith("/api/models")) {
    return false;
  }
  // Model stream is event replay only; allow it even while runtime is warming up.
  return pathname !== "/api/models/stream";
}

async function maybeGateAiRoute(
  method: string,
  pathname: string,
): Promise<Response | null> {
  if (!requiresAiRuntime(method, pathname)) {
    return null;
  }
  if (!isRuntimeReadinessManaged()) {
    return null;
  }
  if (isRuntimeReadyForAiRequests()) {
    return null;
  }

  if (runtimeReadyState === "pending") {
    try {
      await Promise.race([
        getRuntimeReady(),
        delay(AI_READY_WAIT_MS),
      ]);
    } catch {
      // Runtime readiness failed or server was not started via serveCommand.
    }
    if (isRuntimeReadyForAiRequests()) {
      return null;
    }
  }

  const response = runtimeReadyState === "failed"
    ? jsonError(
      "AI runtime initialization failed. Restart HLVM and check logs.",
      503,
    )
    : jsonError(
      "AI runtime is still initializing. Please retry shortly.",
      503,
    );
  response.headers.set(
    "Retry-After",
    runtimeReadyState === "failed" ? "5" : "1",
  );
  return response;
}

function encodeHqlString(value: string): string {
  return `"${escapeString(value)}"`;
}

function buildExecuteCode(
  definition: BindingFunctionItem,
  args: string[],
): string {
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
 *     tags: [Bindings]
 *     summary: List available HQL binding functions
 *     operationId: listBindingFunctions
 *     responses:
 *       '200':
 *         description: Array of binding functions.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 functions:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/BindingFunction'
 *       '500':
 *         description: Failed to list functions.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
async function handleBindingFunctions(): Promise<Response> {
  try {
    const functions = await listBindingFunctions();
    const payload: BindingFunctionsResponse = { functions };
    return Response.json(payload);
  } catch (error) {
    log.error("Binding functions list failed", error);
    return jsonError(getErrorMessage(error), 500);
  }
}

function execError(message: string, code: string): Response {
  return Response.json(
    {
      output: "",
      status: "error",
      error: { message, code },
    } satisfies BindingExecuteResponse,
  );
}

/**
 * @openapi
 * /api/memory/functions/execute:
 *   post:
 *     tags: [Bindings]
 *     summary: Execute an HQL binding function
 *     operationId: executeBindingFunction
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
async function handleBindingExecute(req: Request): Promise<Response> {
  try {
    const parsed = await parseJsonBody<BindingExecuteRequest>(req);
    if (!parsed.ok) return parsed.response;

    const { functionName, args = [] } = parsed.value;
    if (typeof functionName !== "string" || functionName.length === 0) {
      return jsonError("Missing functionName", 400);
    }
    if (!Array.isArray(args) || !args.every((arg) => typeof arg === "string")) {
      return jsonError("args must be an array of strings", 400);
    }

    const definitions = await listBindingFunctions();
    const definition = definitions.find((def) => def.name === functionName);
    if (!definition) {
      return execError(
        `Function '${functionName}' not found`,
        "FUNCTION_NOT_FOUND",
      );
    }

    if (definition.kind === "defn" && args.length !== definition.arity) {
      return execError(
        `Arity mismatch: expected ${definition.arity} args, got ${args.length}`,
        "ARITY_MISMATCH",
      );
    }
    if (definition.kind === "def" && args.length !== 0) {
      return execError("def values do not accept arguments", "ARITY_MISMATCH");
    }

    if (!replState) {
      replState = await initState();
    }

    const code = buildExecuteCode(definition, args);
    const result = await evaluate(code, replState);
    if (!result.success) {
      return execError(
        result.error?.message ?? "Execution failed",
        "EXECUTION_ERROR",
      );
    }

    const hasValue = Object.prototype.hasOwnProperty.call(result, "value");
    const output = hasValue ? formatPlainValue(result.value) : "";
    return Response.json(
      { output, status: "success" } satisfies BindingExecuteResponse,
    );
  } catch (error) {
    log.error("Binding execute failed", error);
    return jsonError(getErrorMessage(error), 500);
  }
}

// MARK: - Router Setup

const router = createRouter();

router.add("POST", "/api/chat", (req) => handleChat(req));
router.add("POST", "/eval", (req) => handleEval(req));
router.add("POST", "/api/chat/cancel", (req) => handleChatCancel(req));
router.add(
  "POST",
  "/api/chat/interaction",
  (req) => handleChatInteraction(req),
);
router.add(
  "POST",
  "/api/attachments/register",
  (req) => handleRegisterAttachment(req),
);
router.add(
  "POST",
  "/api/attachments/upload",
  (req) => handleUploadAttachment(req),
);
router.add(
  "GET",
  "/api/attachments/:id",
  (req, p) => handleGetAttachment(req, p),
);
router.add(
  "GET",
  "/api/attachments/:id/content",
  (req, p) => handleGetAttachmentContent(req, p),
);

router.add("GET", "/api/chat/stream", (req) => handleActiveConversationStream(req));
router.add("GET", "/api/chat/messages", (req) => handleGetActiveMessages(req));
router.add("POST", "/api/chat/messages", (req) => handleAddActiveMessage(req));
router.add(
  "GET",
  "/api/chat/messages/:messageId",
  (req, p) => handleGetActiveMessage(req, p),
);
router.add(
  "PATCH",
  "/api/chat/messages/:messageId",
  (req, p) => handleUpdateActiveMessage(req, p),
);
router.add(
  "DELETE",
  "/api/chat/messages/:messageId",
  (req, p) => handleDeleteActiveMessage(req, p),
);

router.add("GET", "/api/models", () => handleListModels());
router.add(
  "GET",
  "/api/models/installed",
  (req) => handleListInstalledModels(req),
);
router.add("GET", "/api/models/discovery", (req) => handleModelDiscovery(req));
router.add("GET", "/api/models/catalog", () => handleModelCatalog());
router.add("GET", "/api/models/status", () => handleModelStatus());
router.add(
  "GET",
  "/api/models/:provider/:name",
  (req, p) => handleGetModel(req, p),
);
router.add("POST", "/api/models/pull", (req) => handlePullModel(req));
router.add(
  "POST",
  "/api/models/verify-access",
  (req) => handleVerifyModelAccess(req),
);
router.add(
  "DELETE",
  "/api/models/:provider/:name",
  (req, p) => handleDeleteModel(req, p),
);
router.add("GET", "/api/models/stream", (req) => handleModelsStream(req));

router.add("POST", "/api/completions", (req) => handleComplete(req));

router.add("GET", "/api/config", () => handleGetConfig());
router.add("PATCH", "/api/config", (req) => handlePatchConfig(req));
router.add("POST", "/api/config/reload", () => handleReloadConfig());
router.add("POST", "/api/config/reset", () => handleResetConfig());
router.add("GET", "/api/config/stream", (req) => handleConfigStream(req));

router.add("GET", "/api/mcp/servers", () => handleListMcpServers());
router.add("POST", "/api/mcp/servers", (req) => handleAddMcpServer(req));
router.add("DELETE", "/api/mcp/servers", (req) => handleRemoveMcpServer(req));
router.add("POST", "/api/mcp/oauth/login", (req) => handleLoginMcpServer(req));
router.add(
  "POST",
  "/api/mcp/oauth/logout",
  (req) => handleLogoutMcpServer(req),
);

router.add(
  "POST",
  "/api/providers/ollama/signin",
  (req) => handleOllamaSignin(req),
);

router.add(
  "POST",
  "/api/companion/observe",
  (req) => handleCompanionObserve(req),
);
router.add("GET", "/api/companion/stream", (req) => handleCompanionStream(req));
router.add(
  "POST",
  "/api/companion/respond",
  (req) => handleCompanionRespond(req),
);
router.add("GET", "/api/companion/status", () => handleCompanionStatus());
router.add(
  "POST",
  "/api/companion/config",
  (req) => handleCompanionConfig(req),
);

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
    return addCorsHeaders(await handleHealth(), origin);
  }

  // Auth check: require Bearer token for all other routes
  if (serverAuthToken) {
    const authHeader = req.headers.get("Authorization") ?? "";
    if (authHeader !== `Bearer ${serverAuthToken}`) {
      return addCorsHeaders(jsonError("Unauthorized", 401), origin);
    }
  }

  const aiGateResponse = await maybeGateAiRoute(req.method, url.pathname);
  if (aiGateResponse) {
    return addCorsHeaders(aiGateResponse, origin);
  }

  if (req.method === "POST" && url.pathname === "/api/runtime/shutdown") {
    return addCorsHeaders(await handleRuntimeShutdown(), origin);
  }

  if (req.method === "GET" && url.pathname === "/api/memory/functions") {
    return addCorsHeaders(await handleBindingFunctions(), origin);
  }

  if (
    req.method === "POST" && url.pathname === "/api/memory/functions/execute"
  ) {
    return addCorsHeaders(await handleBindingExecute(req), origin);
  }

  const match = router.match(req.method, url.pathname);
  if (match) {
    try {
      const response = await match.handler(req, match.params);
      return addCorsHeaders(response, origin);
    } catch (error) {
      const msg = getErrorMessage(error);
      return addCorsHeaders(jsonError(msg, 500), origin);
    }
  }

  return addCorsHeaders(jsonError("Not found", 404), origin);
}

// MARK: - Server

export interface StartHttpServerOptions {
  port?: number;
}

export async function startHttpServer(
  options: StartHttpServerOptions = {},
): Promise<void> {
  const port = options.port ?? resolvePort();

  // Use pre-shared token from env (GUI passes this) or generate a random one
  serverAuthToken = getPlatform().env.get("HLVM_AUTH_TOKEN") ||
    crypto.randomUUID();
  log.info(`REPL auth token: ${serverAuthToken}`);

  try {
    log.info(`Starting REPL HTTP server on port ${port}...`);
    if (platform.http.serveWithHandle) {
      serverHandle = platform.http.serveWithHandle(handleRequest, {
        port,
        hostname: "127.0.0.1",
        onListen: ({ hostname, port }) => {
          log.info(`REPL HTTP server listening on http://${hostname}:${port}`);
        },
      });
      await serverHandle.finished;
    } else {
      await platform.http.serve(handleRequest, {
        port,
        hostname: "127.0.0.1",
        onListen: ({ hostname, port }) => {
          log.info(`REPL HTTP server listening on http://${hostname}:${port}`);
        },
      });
    }
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
    throw new RuntimeError(
      `REPL server failed to start: ${getErrorMessage(error)}`,
    );
  } finally {
    serverHandle = null;
  }
}
