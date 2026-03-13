/**
 * Config Handler
 *
 * GET  /api/config — Return full config.
 * PATCH /api/config — Partial update of config values.
 */

import { config } from "../../../api/config.ts";
import { parseJsonBody, jsonError, createSSEResponse } from "../http-utils.ts";
import { isConfigKey } from "../../../../common/config/storage.ts";
import { getErrorMessage } from "../../../../common/utils.ts";
import { validateValue } from "../../../../common/config/types.ts";
import { getPlatform } from "../../../../platform/platform.ts";
import { debounce } from "@std/async";

/**
 * @openapi
 * /api/config:
 *   get:
 *     tags: [Config]
 *     summary: Get the current configuration
 *     operationId: getConfig
 *     responses:
 *       '200':
 *         description: Current config values.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/HlvmConfig'
 */
export async function handleGetConfig(): Promise<Response> {
  const cfg = await config.all;
  return Response.json(cfg);
}

/**
 * @openapi
 * /api/config:
 *   patch:
 *     tags: [Config]
 *     summary: Update configuration values
 *     operationId: patchConfig
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/HlvmConfig'
 *     responses:
 *       '200':
 *         description: Updated config.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/HlvmConfig'
 *       '400':
 *         description: Unknown key or invalid value.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       '500':
 *         description: Failed to persist config.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
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
    return jsonError(getErrorMessage(error), 500);
  }
}

/**
 * @openapi
 * /api/config/reset:
 *   post:
 *     tags: [Config]
 *     summary: Reset configuration to defaults
 *     operationId: resetConfig
 */
export async function handleResetConfig(): Promise<Response> {
  try {
    const updated = await config.reset();
    return Response.json(updated);
  } catch (error) {
    return jsonError(
      getErrorMessage(error),
      500,
    );
  }
}

/**
 * @openapi
 * /api/config/reload:
 *   post:
 *     tags: [Config]
 *     summary: Reload configuration from disk
 *     operationId: reloadConfig
 */
export async function handleReloadConfig(): Promise<Response> {
  try {
    const updated = await config.reload();
    return Response.json(updated);
  } catch (error) {
    return jsonError(
      getErrorMessage(error),
      500,
    );
  }
}

/**
 * @openapi
 * /api/config/stream:
 *   get:
 *     tags: [Config]
 *     summary: SSE stream of config changes
 *     operationId: streamConfig
 *     description: |
 *       Server-Sent Events stream. Emits config_updated events with the full config
 *       object whenever the configuration changes (including external file edits).
 *     responses:
 *       '200':
 *         description: SSE event stream.
 *         content:
 *           text/event-stream:
 *             schema:
 *               type: string
 *         x-response-type: stream
 */
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
    const debouncedReload = debounce(() => {
      void config.reloadIfChanged();
    }, 500);
    const watcher = getPlatform().fs.watchFs(config.path);
    const watcherDone = (async () => {
      for await (const event of watcher) {
        if (event.kind === "modify") {
          debouncedReload();
        }
      }
    })();
    // Suppress unhandled rejection when watcher is closed
    watcherDone.catch(() => {});

    return () => {
      unsubConfig();
      debouncedReload.clear();
      watcher.close();
    };
  });
}
