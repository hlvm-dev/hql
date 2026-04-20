import { loadConfig } from "../../../../common/config/storage.ts";
import { channelRuntime } from "../../../channels/core/runtime.ts";
import type { ChannelStatus } from "../../../channels/core/types.ts";
import { createSSEResponse } from "../http-utils.ts";

export async function handleReachabilityStatus(): Promise<Response> {
  const config = await loadConfig();
  const runtimeStatuses = new Map(
    channelRuntime.listStatuses().map((status) => [status.channel, status]),
  );

  const channels = Object.entries(config.channels ?? {})
    .map(([channel, channelConfig]) =>
      runtimeStatuses.get(channel) ?? {
        channel,
        configured: true,
        enabled: channelConfig.enabled === true,
        state: channelConfig.enabled === true ? "unsupported" : "disabled",
        mode: channelConfig.transport?.mode,
        allowedIds: [...(channelConfig.allowedIds ?? [])],
        lastError: null,
      }
    )
    .sort((left, right) => left.channel.localeCompare(right.channel));

  return Response.json({ channels });
}

export async function handleReachabilityRebind(): Promise<Response> {
  await channelRuntime.reconfigure();
  return Response.json({ channels: channelRuntime.listStatuses() });
}

export function handleReachabilityEvents(req: Request): Response {
  let seq = 0;
  return createSSEResponse(req, (emit) => {
    const send = (channels: ChannelStatus[]): void => {
      emit(
        `id: ${++seq}\nevent: reachability_updated\ndata: ${
          JSON.stringify({ channels })
        }\n\n`,
      );
    };
    send(channelRuntime.listStatuses());
    return channelRuntime.subscribe(send);
  });
}
