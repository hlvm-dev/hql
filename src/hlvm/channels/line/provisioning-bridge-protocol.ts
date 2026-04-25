export interface LineProvisioningBridgeRegistration {
  sessionId: string;
  deviceId: string;
  clientToken: string;
  pairCode: string;
  officialAccountId?: string;
  createdAt: string;
  expiresAt: string;
}

export interface LineProvisioningBridgeSessionSnapshot {
  sessionId: string;
  state: "pending" | "completed";
  pairCode: string;
  officialAccountId: string;
  setupUrl: string;
  createdAt: string;
  expiresAt: string;
  completedAt?: string;
}

export interface LineBridgeMessageEvent {
  id: string;
  type: "message";
  userId: string;
  text: string;
  timestamp: number;
  raw?: unknown;
}

export interface LineBridgeSendMessageRequest {
  deviceId: string;
  clientToken: string;
  to: string;
  text: string;
}

export interface LineBridgeSendMessageResult {
  ok: true;
}
