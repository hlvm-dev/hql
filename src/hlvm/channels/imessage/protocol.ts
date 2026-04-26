import type { ChannelSetupSession } from "../core/types.ts";
import type { RuntimeReachabilityChannelStatus } from "../../runtime/reachability-protocol.ts";

export interface IMessageProvisioningCreateRequest {
  recipientId?: string;
}

export interface IMessageSetupSession extends ChannelSetupSession {
  channel: "imessage";
  qrKind: "open_bot";
  recipientId: string;
}

export interface IMessageProvisioningCompleteRequest {
  sessionId: string;
}

export interface IMessageProvisioningCompletionResult {
  session: IMessageSetupSession;
  status?: RuntimeReachabilityChannelStatus;
}
