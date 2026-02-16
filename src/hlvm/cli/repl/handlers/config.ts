/**
 * Config Handler
 *
 * GET  /api/config — Return full config.
 * PATCH /api/config — Partial update of config values.
 */

import { config } from "../../../api/config.ts";
import { parseJsonBody, jsonError, createSSEResponse } from "../http-utils.ts";
import { isConfigKey } from "../../../../common/config/storage.ts";
import { validateValue } from "../../../../common/config/types.ts";
import { getPlatform } from "../../../../platform/platform.ts";

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

  return createSSEResponse(req, (emit) => {
    const emitConfig = (payload: unknown): void => {
      emit(`id: ${nextEventId}\nevent: config_updated\ndata: ${JSON.stringify(payload)}\n\n`);
      nextEventId++;
    };

    const unsubConfig = config.subscribe((nextConfig) => {
      emitConfig(nextConfig);
    });

    void config.reload();

    // Watch config file for external changes (replaces 1s polling interval)
    let debounceTimer: ReturnType<typeof setTimeout> | null = null;
    const watcher = getPlatform().fs.watchFs(config.path);
    const watcherDone = (async () => {
      for await (const event of watcher) {
        if (event.kind === "modify") {
          if (debounceTimer !== null) clearTimeout(debounceTimer);
          debounceTimer = setTimeout(() => {
            void config.reloadIfChanged();
          }, 500);
        }
      }
    })();
    // Suppress unhandled rejection when watcher is closed
    watcherDone.catch(() => {});

    return () => {
      unsubConfig();
      if (debounceTimer !== null) clearTimeout(debounceTimer);
      watcher.close();
    };
  });
}
