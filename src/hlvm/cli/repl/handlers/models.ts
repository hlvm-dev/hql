/**
 * Model Handlers
 *
 * Proxies to ai.models.* and ai.status() from the AI API module.
 */

import { ai } from "../../../api/ai.ts";
import { pushSSEEvent, subscribe, replayAfter } from "../../../store/sse-store.ts";
import type { SSEEvent } from "../../../store/types.ts";
import type { RouteParams } from "../http-router.ts";
import { parseJsonBody, jsonError, ndjsonLine, textEncoder } from "../http-utils.ts";
import { getErrorMessage } from "../../../../common/utils.ts";
import { listRegisteredProviders } from "../../../providers/index.ts";

const MODELS_CHANNEL = "__models__";

function formatSSE(event: SSEEvent): string {
  return `id: ${event.id}\nevent: ${event.event_type}\ndata: ${JSON.stringify(event.data)}\n\n`;
}

function pushModelsUpdated(reason: string, detail?: Record<string, unknown>): void {
  pushSSEEvent(MODELS_CHANNEL, "models_updated", { reason, ...(detail ?? {}) });
}

export function handleModelsStream(req: Request): Response {
  const lastEventId = req.headers.get("Last-Event-ID");

  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(textEncoder.encode("retry: 3000\n\n"));

      const replay = replayAfter(MODELS_CHANNEL, lastEventId);
      if (replay.gapDetected) {
        controller.enqueue(textEncoder.encode(
          `event: models_updated\ndata: ${JSON.stringify({ reason: "replay_gap" })}\n\n`
        ));
      } else {
        for (const event of replay.events) {
          controller.enqueue(textEncoder.encode(formatSSE(event)));
        }
      }

      const unsubscribe = subscribe(MODELS_CHANNEL, (event) => {
        try {
          controller.enqueue(textEncoder.encode(formatSSE(event)));
        } catch {
          // Stream closed
        }
      });

      const heartbeat = setInterval(() => {
        try {
          controller.enqueue(textEncoder.encode(": heartbeat\n\n"));
        } catch {
          clearInterval(heartbeat);
        }
      }, 30_000);

      req.signal.addEventListener("abort", () => {
        unsubscribe();
        clearInterval(heartbeat);
        try {
          controller.close();
        } catch {
          // Already closed
        }
      });
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive",
    },
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
  const statuses: Record<string, unknown> = {};

  for (const name of providerNames) {
    try {
      statuses[name] = await ai.status(name);
    } catch {
      statuses[name] = { available: false, error: "Failed to check status" };
    }
  }

  return Response.json({ providers: statuses });
}
