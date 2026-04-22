import { channelRuntime } from "../../../../channels/registry.ts";
import type { RouteParams } from "../../http-router.ts";
import { jsonError, parseJsonBody } from "../../http-utils.ts";

interface ArmBody {
  code: string;
}

/**
 * POST /api/channels/:channel/arm-pair-code
 *
 * Arms a pair code for the named channel. While armed, the first
 * inbound message that the channel transport recognizes as that code
 * and whose channel has an empty allowedIds becomes the paired sender
 * — the runtime records them in allowedIds, clears the code, and emits
 * a canned confirmation reply (see runtime.ts `performPairing`).
 *
 * The default matcher accepts `^\s*HLVM-<code>\b` text. Transports can
 * override matching for vendor-native first-contact flows.
 *
 * The endpoint is per-channel generic so Telegram and later platforms
 * reuse it without new routes.
 */
export async function handleArmPairCode(
  req: Request,
  params: RouteParams,
): Promise<Response> {
  const channel = params.channel;
  if (!channel) return jsonError("Missing :channel path parameter", 400);

  const status = channelRuntime.getStatus(channel);
  if (!status || !status.configured) {
    return jsonError(`Channel not configured: ${channel}`, 404);
  }
  if (!status.enabled) {
    return jsonError(`Channel not enabled: ${channel}`, 409);
  }

  const parsed = await parseJsonBody<ArmBody>(req);
  if (!parsed.ok) return parsed.response;

  const body = parsed.value;
  if (!body || typeof body.code !== "string" || body.code.length === 0) {
    return jsonError("Body must include code: non-empty string", 400);
  }

  channelRuntime.armPairCode(channel, body.code);
  return Response.json(
    { armed: true, channel, code: body.code },
    { status: 200 },
  );
}

/**
 * POST /api/channels/:channel/disarm-pair-code
 *
 * Idempotent. Called when the onboarding window closes without
 * pairing (best-effort — the armed state is in-memory anyway, so a
 * server restart also clears it).
 */
export function handleDisarmPairCode(
  _req: Request,
  params: RouteParams,
): Response {
  const channel = params.channel;
  if (!channel) return jsonError("Missing :channel path parameter", 400);

  channelRuntime.disarmPairCode(channel);
  return Response.json({ disarmed: true, channel }, { status: 200 });
}
