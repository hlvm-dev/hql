export interface TelegramProvisioningBridgeRegistration {
  sessionId: string;
  claimToken: string;
  deviceId?: string;
  managerBotUsername: string;
  botName: string;
  botUsername: string;
  createdAt?: string;
  expiresAt: string;
}

export interface TelegramProvisioningBridgeSessionSnapshot {
  sessionId: string;
  state: "pending" | "completed" | "claimed";
  managerBotUsername: string;
  botName: string;
  botUsername: string;
  createUrl: string;
  createdAt: string;
  expiresAt: string;
  completedAt?: string;
}

export interface TelegramProvisioningBridgeCompletionInput {
  sessionId: string;
  token: string;
  username?: string;
  ownerUserId?: number;
}

export interface TelegramProvisioningBridgeClaimRequest {
  sessionId: string;
  claimToken: string;
  waitMs?: number;
}

export type TelegramProvisioningBridgeClaimFailureReason =
  "claimed" | "forbidden" | "missing" | "pending";

export type TelegramProvisioningBridgeClaimResult =
  | {
    ok: true;
    session: TelegramProvisioningBridgeSessionSnapshot;
    token: string;
    username: string;
    ownerUserId?: number;
  }
  | {
    ok: false;
    reason: TelegramProvisioningBridgeClaimFailureReason;
  };
