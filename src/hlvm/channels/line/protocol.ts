import type { ChannelSetupSession } from "../core/types.ts";
import type { RuntimeReachabilityChannelStatus } from "../../runtime/reachability-protocol.ts";

export interface LineProvisioningCreateRequest {
  officialAccountId?: string;
}

export interface LineSetupSession extends ChannelSetupSession {
  channel: "line";
  pairCode: string;
  qrKind: "connect_account";
  officialAccountId: string;
}

export interface LineProvisioningCompleteRequest {
  sessionId: string;
}

export interface LineProvisioningCompletionResult {
  session: LineSetupSession;
  status?: RuntimeReachabilityChannelStatus;
}

export function buildLineOfficialAccountMessageUrl(
  officialAccountId: string,
  text: string,
): string {
  const encodedAccountId = encodeURIComponent(officialAccountId.trim());
  const encodedText = encodeURIComponent(text);
  return `https://line.me/R/oaMessage/${encodedAccountId}/?${encodedText}`;
}

