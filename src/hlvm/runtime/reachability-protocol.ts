import type { ChannelTransportMode } from "../../common/config/types.ts";
import type { ChannelConnectionState } from "../channels/core/types.ts";

export interface RuntimeReachabilityChannelStatus {
  channel: string;
  configured: boolean;
  enabled: boolean;
  state: ChannelConnectionState;
  mode?: ChannelTransportMode;
  allowedIds: string[];
  lastError: string | null;
}

export interface RuntimeReachabilityStatusResponse {
  channels: RuntimeReachabilityChannelStatus[];
}

export interface RuntimeReachabilityUpdatedEvent {
  id?: string;
  event_type: "reachability_updated";
  data: RuntimeReachabilityStatusResponse;
}
