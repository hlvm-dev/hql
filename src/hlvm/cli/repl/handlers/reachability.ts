import { loadConfig } from "../../../../common/config/storage.ts";
import { channelRuntime } from "../../../channels/registry.ts";
import type { ChannelStatus } from "../../../channels/core/types.ts";
import type { HlvmConfig } from "../../../../common/config/types.ts";
import { createSSEResponse, formatSSE } from "../http-utils.ts";

interface ReachabilityRuntime {
  listStatuses(): ChannelStatus[];
  reconfigure(): Promise<void>;
  subscribe(listener: (statuses: ChannelStatus[]) => void): () => void;
}

export interface ReachabilityDeps {
  loadConfig?: () => Promise<HlvmConfig>;
  runtime?: ReachabilityRuntime;
}

export async function handleReachabilityStatus(
  deps: ReachabilityDeps = {},
): Promise<Response> {
  const loadCfg = deps.loadConfig ?? loadConfig;
  const runtime = deps.runtime ?? channelRuntime;

  const config = await loadCfg();
  const runtimeStatuses = new Map(
    runtime.listStatuses().map((status) => [status.channel, status]),
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

export async function handleReachabilityRebind(
  deps: ReachabilityDeps = {},
): Promise<Response> {
  const runtime = deps.runtime ?? channelRuntime;
  await runtime.reconfigure();
  return Response.json({ channels: runtime.listStatuses() });
}

export function handleReachabilityEvents(
  req: Request,
  deps: ReachabilityDeps = {},
): Response {
  const runtime = deps.runtime ?? channelRuntime;
  let seq = 0;
  return createSSEResponse(req, (emit) => {
    const send = (channels: ChannelStatus[]): void => {
      emit(formatSSE({
        id: ++seq,
        event_type: "reachability_updated",
        data: { channels },
      }));
    };
    send(runtime.listStatuses());
    return runtime.subscribe(send);
  });
}
