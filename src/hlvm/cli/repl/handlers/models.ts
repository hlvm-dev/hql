/**
 * Model Handlers
 *
 * Proxies to ai.models.* and ai.status() from the AI API module.
 */

import { ai } from "../../../api/ai.ts";
import type { RouteParams } from "../http-router.ts";
import { parseJsonBody, jsonError, ndjsonLine } from "../http-utils.ts";
import { getErrorMessage } from "../../../../common/utils.ts";
import { listRegisteredProviders } from "../../../providers/index.ts";

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
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const parsed = await parseJsonBody<{
        name: string;
        provider?: string;
      }>(req);

      if (!parsed.ok) {
        controller.enqueue(encoder.encode(
          ndjsonLine({ event: "error", message: "Invalid request" })
        ));
        controller.close();
        return;
      }

      const { name, provider } = parsed.value;
      if (!name) {
        controller.enqueue(encoder.encode(
          ndjsonLine({ event: "error", message: "Missing model name" })
        ));
        controller.close();
        return;
      }

      try {
        for await (const progress of ai.models.pull(name, provider, req.signal)) {
          controller.enqueue(encoder.encode(
            ndjsonLine({ event: "progress", ...progress })
          ));
        }
        controller.enqueue(encoder.encode(
          ndjsonLine({ event: "complete", name })
        ));
      } catch (error) {
        controller.enqueue(encoder.encode(
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
  return Response.json({ deleted: true });
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
