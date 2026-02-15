/**
 * Config Handler
 *
 * GET  /api/config — Return full config.
 * PATCH /api/config — Partial update of config values.
 */

import { config } from "../../../api/config.ts";
import { parseJsonBody, jsonError, textEncoder } from "../http-utils.ts";
import { isConfigKey } from "../../../../common/config/storage.ts";
import { validateValue } from "../../../../common/config/types.ts";

function formatConfigSSE(payload: unknown, eventId: number): string {
  return `id: ${eventId}\nevent: config_updated\ndata: ${JSON.stringify(payload)}\n\n`;
}

export async function handleGetConfig(): Promise<Response> {
  const cfg = await config.all;
  return Response.json(cfg);
}

export async function handlePatchConfig(req: Request): Promise<Response> {
  const parsed = await parseJsonBody<Record<string, unknown>>(req);
  if (!parsed.ok) return parsed.response;

  const updates = parsed.value;
  if (!updates || typeof updates !== "object" || Object.keys(updates).length === 0) {
    return jsonError("Body must be a non-empty object", 400);
  }

  for (const [key, value] of Object.entries(updates)) {
    if (!isConfigKey(key)) return jsonError(`Unknown config key: ${key}`, 400);
    const v = validateValue(key, value);
    if (!v.valid) return jsonError(v.error ?? `Invalid value for ${key}`, 400);
  }

  try {
    const updated = await config.patch(updates);
    return Response.json(updated);
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "Failed to update config", 500);
  }
}

export function handleConfigStream(req: Request): Response {
  let nextEventId = Date.now();

  const stream = new ReadableStream({
    start(controller) {
      let closed = false;
      let unsubscribe = () => {};
      let heartbeat: ReturnType<typeof setInterval> | null = null;

      const cleanup = (): void => {
        if (closed) return;
        closed = true;
        unsubscribe();
        if (heartbeat !== null) {
          clearInterval(heartbeat);
        }
        try {
          controller.close();
        } catch {
          // Already closed
        }
      };

      const emitConfig = (payload: unknown): void => {
        if (closed) return;
        try {
          controller.enqueue(textEncoder.encode(formatConfigSSE(payload, nextEventId++)));
        } catch {
          cleanup();
        }
      };

      controller.enqueue(textEncoder.encode("retry: 3000\n\n"));
      emitConfig(config.snapshot);

      unsubscribe = config.subscribe((nextConfig) => {
        emitConfig(nextConfig);
      });

      heartbeat = setInterval(() => {
        if (closed) return;
        try {
          controller.enqueue(textEncoder.encode(": heartbeat\n\n"));
        } catch {
          cleanup();
        }
      }, 30_000);

      req.signal.addEventListener("abort", cleanup);
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
