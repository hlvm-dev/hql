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

const MODELS_CHANNEL = "__models__";

function pushModelsUpdated(reason: string, detail?: Record<string, unknown>): void {
  pushSSEEvent(MODELS_CHANNEL, "models_updated", { reason, ...(detail ?? {}) });
}

export function handleModelsStream(req: Request): Response {
  const lastEventId = req.headers.get("Last-Event-ID");

  return createSSEResponse(req, (emit) => {
    const replay = replayAfter(MODELS_CHANNEL, lastEventId);
    if (replay.gapDetected) {
      emit(`event: models_updated\ndata: ${JSON.stringify({ reason: "replay_gap" })}\n\n`);
    } else {
      for (const event of replay.events) {
        emit(formatSSE(event));
      }
    }

    const unsubscribe = subscribe(MODELS_CHANNEL, (event) => {
      emit(formatSSE(event));
    });
    return unsubscribe;
  });
}

export async function handleListModels(): Promise<Response> {
  const models = await ai.models.listAll();
  return Response.json({ models });
}

export async function handleGetModel(
  _req: Request,
  params: RouteParams,
): Promise<Response> {
  const model = await ai.models.get(params.name, params.provider);
  if (!model) return jsonError("Model not found", 404);
  return Response.json(model);
}

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

export async function handleDeleteModel(
  _req: Request,
  params: RouteParams,
): Promise<Response> {
  const deleted = await ai.models.remove(params.name, params.provider);
  if (!deleted) return jsonError("Model not found or cannot be deleted", 404);
  pushModelsUpdated("deleted", { name: params.name, provider: params.provider });
  return Response.json({ deleted: true });
}

export async function handleModelCatalog(): Promise<Response> {
  const catalog = await ai.models.catalog("ollama");
  return Response.json({ models: catalog });
}

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
