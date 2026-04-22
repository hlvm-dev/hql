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

export interface RuntimeTelegramProvisioningCreateRequest {
  managerBotUsername?: string;
  botName?: string;
  botUsername?: string;
}

export interface RuntimeTelegramProvisioningSessionSnapshot {
  sessionId: string;
  state: "completed" | "pending";
  pairCode: string;
  managerBotUsername: string;
  botName: string;
  botUsername: string;
  qrKind: "create_bot" | "open_bot";
  qrUrl: string;
  provisionUrl?: string;
  createUrl: string;
  createdAt: string;
  expiresAt: string;
  completedAt?: string;
}

export interface RuntimeTelegramProvisioningCompleteRequest {
  sessionId: string;
  token: string;
  username?: string;
}

export interface RuntimeTelegramProvisioningCompletionResult {
  session: RuntimeTelegramProvisioningSessionSnapshot;
  status?: RuntimeReachabilityChannelStatus;
}

export interface RuntimeTelegramProvisioningCancelResponse {
  cancelled: boolean;
}
