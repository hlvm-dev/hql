import { ValidationError } from "../../../common/error.ts";

const CHANNEL_SESSION_PREFIX = "channel:";

export function isChannelSessionId(
  sessionId: string | null | undefined,
): boolean {
  return typeof sessionId === "string" &&
    sessionId.startsWith(CHANNEL_SESSION_PREFIX);
}

function normalizeKeyPart(
  value: string,
  label: "channel" | "remoteId",
): string {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new ValidationError(
      `Channel session ${label} must not be empty.`,
      "channel_session",
    );
  }
  if (trimmed.includes(":")) {
    throw new ValidationError(
      `Channel session ${label} must not contain ':'.`,
      "channel_session",
    );
  }
  return trimmed;
}

export function formatChannelSessionId(
  channel: string,
  remoteId: string,
): string {
  return `${CHANNEL_SESSION_PREFIX}${normalizeKeyPart(channel, "channel")}:${
    normalizeKeyPart(remoteId, "remoteId")
  }`;
}
