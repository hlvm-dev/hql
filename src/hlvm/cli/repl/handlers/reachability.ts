import { loadConfig } from "../../../../common/config/storage.ts";
import { channelRuntime } from "../../../channels/core/runtime.ts";

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
