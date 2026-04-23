import type { ChannelSetupSession } from "../core/types.ts";
import type { RuntimeReachabilityChannelStatus } from "../../runtime/reachability-protocol.ts";

export interface TelegramProvisioningCreateRequest {
  managerBotUsername?: string;
  botName?: string;
  botUsername?: string;
}

export interface TelegramSetupSession extends ChannelSetupSession {
  channel: "telegram";
  pairCode: string;
  managerBotUsername: string;
  botName: string;
  botUsername: string;
  qrKind: "create_bot" | "open_bot";
  provisionUrl?: string;
  createUrl: string;
}

export interface TelegramProvisioningCompleteRequest {
  sessionId: string;
  token: string;
  username?: string;
  ownerUserId?: number;
}

export interface TelegramProvisioningCompletionResult {
  session: TelegramSetupSession;
  status?: RuntimeReachabilityChannelStatus;
}
