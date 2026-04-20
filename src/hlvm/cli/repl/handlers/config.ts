/**
 * Config Handler
 *
 * GET  /api/config — Return full config.
 * PATCH /api/config — Partial update of config values.
 */

import { config } from "../../../api/config.ts";
import {
  createSSEResponse,
  formatSSE,
  jsonError,
  jsonErrorFromUnknown,
  parseJsonBody,
} from "../http-utils.ts";
import { isConfigKey } from "../../../../common/config/storage.ts";
import { getErrorMessage } from "../../../../common/utils.ts";
import { validateValue } from "../../../../common/config/types.ts";
import { normalizeSelectedModelId } from "../../../../common/config/model-selection.ts";
import { getPlatform } from "../../../../platform/platform.ts";
import { debounce } from "@std/async";
import { supportsAgentExecution } from "../../../agent/constants.ts";

function computeSupportsAgent(model?: string): boolean {
  if (!model) return false;
  return supportsAgentExecution(model, null);
}

function buildClientConfigPayload(
  cfg: Awaited<typeof config.all>,
  supportsAgent: boolean,
) {
  return {
    ...cfg,
    selectedModelIdentifier:
      normalizeSelectedModelId(cfg.model, cfg.agentMode) ?? cfg.model,
    supportsAgent,
  };
}

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
  const supportsAgent = computeSupportsAgent(cfg.model);
  return Response.json(buildClientConfigPayload(cfg, supportsAgent));
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
    const supportsAgent = computeSupportsAgent(updated.model);
    return Response.json(buildClientConfigPayload(updated, supportsAgent));
  } catch (error) {
    return await jsonErrorFromUnknown(error, 500);
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
    const supportsAgent = computeSupportsAgent(updated.model);
    return Response.json(buildClientConfigPayload(updated, supportsAgent));
  } catch (error) {
    return await jsonErrorFromUnknown(error, 500);
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
    const supportsAgent = computeSupportsAgent(updated.model);
    return Response.json(buildClientConfigPayload(updated, supportsAgent));
  } catch (error) {
    return await jsonErrorFromUnknown(error, 500);
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
      emit(formatSSE({
        id: nextEventId,
        event_type: "config_updated",
        data: payload,
      }));
      nextEventId++;
    };

    const unsubConfig = config.subscribe((nextConfig) => {
      emitConfig(buildClientConfigPayload(
        nextConfig,
        computeSupportsAgent(nextConfig.model),
      ));
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
