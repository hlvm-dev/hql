/**
 * Model Handlers
 *
 * Proxies to ai.models.* and ai.status() from the AI API module.
 */

import { ai } from "../../../api/ai.ts";
import { pushSSEEvent, subscribe, replayAfter } from "../../../store/sse-store.ts";
import type { RouteParams } from "../http-router.ts";
import { parseJsonBody, jsonError, ndjsonLine, textEncoder, formatSSE, createSSEResponse } from "../http-utils.ts";
import { getErrorMessage } from "../../../../common/utils.ts";
import { listRegisteredProviders } from "../../../providers/index.ts";
import { isRuntimeReadyForAiRequests } from "../../commands/serve.ts";

const MODELS_CHANNEL = "__models__";

function pushModelsUpdated(reason: string, detail?: Record<string, unknown>): void {
  pushSSEEvent(MODELS_CHANNEL, "models_updated", { reason, ...(detail ?? {}) });
}

/**
 * @openapi
 * /api/models/stream:
 *   get:
 *     tags: [Models]
 *     summary: SSE stream of model changes
 *     operationId: streamModels
 *     description: |
 *       Server-Sent Events stream. Events: models_updated (with reason field).
 *     parameters:
 *       - in: header
 *         name: Last-Event-ID
 *         schema:
 *           type: string
 *         description: Resume from this event ID on reconnect.
 *     responses:
 *       '200':
 *         description: SSE event stream.
 *         content:
 *           text/event-stream:
 *             schema:
 *               type: string
 *         x-response-type: stream
 */
export function handleModelsStream(req: Request): Response {
  const lastEventId = req.headers.get("Last-Event-ID");

  return createSSEResponse(req, (emit) => {
    // Replay buffered events for reconnecting clients.
    const replay = replayAfter(MODELS_CHANNEL, lastEventId);
    if (replay.gapDetected) {
      emit(`event: models_updated\ndata: ${JSON.stringify({ reason: "replay_gap" })}\n\n`);
    } else {
      for (const event of replay.events) {
        emit(formatSSE(event));
      }
    }

    // SSE best practice: send current state on connect.
    // If runtime is already ready but the client missed the event (fresh connect
    // with empty buffer, or buffer compacted), tell it immediately.
    const hasRuntimeReadyReplay = replay.events.some(
      (e) => e.event_type === "models_updated" && (e.data as Record<string, unknown>)?.reason === "runtime_ready",
    );
    if (isRuntimeReadyForAiRequests() && !hasRuntimeReadyReplay) {
      emit(`event: models_updated\ndata: ${JSON.stringify({ reason: "runtime_ready" })}\n\n`);
    }

    const unsubscribe = subscribe(MODELS_CHANNEL, (event) => {
      emit(formatSSE(event));
    });
    return unsubscribe;
  });
}

/**
 * @openapi
 * /api/models:
 *   get:
 *     tags: [Models]
 *     summary: List all available models
 *     operationId: listModels
 *     responses:
 *       '200':
 *         description: Array of models.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 models:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/ModelInfo'
 */
export async function handleListModels(): Promise<Response> {
  const models = await ai.models.listAll();
  return Response.json({ models });
}

/**
 * @openapi
 * /api/models/{provider}/{name}:
 *   get:
 *     tags: [Models]
 *     summary: Get a single model
 *     operationId: getModel
 *     parameters:
 *       - in: path
 *         name: provider
 *         required: true
 *         schema:
 *           type: string
 *         description: Provider name (e.g. ollama, openai).
 *       - in: path
 *         name: name
 *         required: true
 *         schema:
 *           type: string
 *         description: Model name.
 *     responses:
 *       '200':
 *         description: Model details.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ModelInfo'
 *       '404':
 *         description: Model not found.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
export async function handleGetModel(
  _req: Request,
  params: RouteParams,
): Promise<Response> {
  const model = await ai.models.get(params.name, params.provider);
  if (!model) return jsonError("Model not found", 404);
  return Response.json(model);
}

/**
 * @openapi
 * /api/models/pull:
 *   post:
 *     tags: [Models]
 *     summary: Pull (download) a model
 *     operationId: pullModel
 *     description: Streams download progress as NDJSON events (progress, complete, error).
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               name:
 *                 type: string
 *               provider:
 *                 type: string
 *             required: [name]
 *     responses:
 *       '200':
 *         description: NDJSON progress stream.
 *         content:
 *           application/x-ndjson:
 *             schema:
 *               oneOf:
 *                 - type: object
 *                   properties:
 *                     event:
 *                       type: string
 *                       enum: [progress]
 *                     status:
 *                       type: string
 *                     completed:
 *                       type: number
 *                     total:
 *                       type: number
 *                 - type: object
 *                   properties:
 *                     event:
 *                       type: string
 *                       enum: [complete]
 *                     name:
 *                       type: string
 *                 - type: object
 *                   properties:
 *                     event:
 *                       type: string
 *                       enum: [error]
 *                     message:
 *                       type: string
 *         x-response-type: stream
 */
export function handlePullModel(req: Request): Response {
  const stream = new ReadableStream({
    async start(controller) {
      const parsed = await parseJsonBody<{
        name: string;
        provider?: string;
      }>(req);

      if (!parsed.ok) {
        controller.enqueue(textEncoder.encode(
          ndjsonLine({ event: "error", message: "Invalid request" })
        ));
        controller.close();
        return;
      }

      const { name, provider } = parsed.value;
      if (!name) {
        controller.enqueue(textEncoder.encode(
          ndjsonLine({ event: "error", message: "Missing model name" })
        ));
        controller.close();
        return;
      }

      try {
        for await (const progress of ai.models.pull(name, provider, req.signal)) {
          controller.enqueue(textEncoder.encode(
            ndjsonLine({ event: "progress", ...progress })
          ));
        }
        controller.enqueue(textEncoder.encode(
          ndjsonLine({ event: "complete", name })
        ));
        pushModelsUpdated("pull_complete", { name, provider: provider ?? null });
      } catch (error) {
        controller.enqueue(textEncoder.encode(
          ndjsonLine({ event: "error", message: getErrorMessage(error) })
        ));
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
    },
  });
}

/**
 * @openapi
 * /api/models/{provider}/{name}:
 *   delete:
 *     tags: [Models]
 *     summary: Delete a model
 *     operationId: deleteModel
 *     parameters:
 *       - in: path
 *         name: provider
 *         required: true
 *         schema:
 *           type: string
 *       - in: path
 *         name: name
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       '200':
 *         description: Model deleted.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 deleted:
 *                   type: boolean
 *       '404':
 *         description: Model not found or cannot be deleted.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
export async function handleDeleteModel(
  _req: Request,
  params: RouteParams,
): Promise<Response> {
  const deleted = await ai.models.remove(params.name, params.provider);
  if (!deleted) return jsonError("Model not found or cannot be deleted", 404);
  pushModelsUpdated("deleted", { name: params.name, provider: params.provider });
  return Response.json({ deleted: true });
}

/**
 * @openapi
 * /api/models/catalog:
 *   get:
 *     tags: [Models]
 *     summary: List models available for download
 *     operationId: modelCatalog
 *     responses:
 *       '200':
 *         description: Catalog of downloadable models.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 models:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/ModelInfo'
 */
export async function handleModelCatalog(): Promise<Response> {
  const catalog = await ai.models.catalog("ollama");
  return Response.json({ models: catalog });
}

/**
 * @openapi
 * /api/models/status:
 *   get:
 *     tags: [Models]
 *     summary: Check availability of all providers
 *     operationId: modelStatus
 *     responses:
 *       '200':
 *         description: Provider status map.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 providers:
 *                   type: object
 *                   additionalProperties:
 *                     type: object
 *                     properties:
 *                       available:
 *                         type: boolean
 *                       error:
 *                         type: string
 */
export async function handleModelStatus(): Promise<Response> {
  const providerNames = listRegisteredProviders();
  const results = await Promise.allSettled(
    providerNames.map((name) => ai.status(name)),
  );
  const statuses: Record<string, unknown> = {};
  providerNames.forEach((name, i) => {
    const r = results[i];
    statuses[name] = r.status === "fulfilled"
      ? r.value
      : { available: false, error: "Failed to check status" };
  });

  return Response.json({ providers: statuses });
}
