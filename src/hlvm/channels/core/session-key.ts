const CHANNEL_SESSION_PREFIX = "channel:";

export function isChannelSessionId(sessionId: string | null | undefined): boolean {
  return typeof sessionId === "string" &&
    sessionId.startsWith(CHANNEL_SESSION_PREFIX);
}

function normalizeKeyPart(value: string, label: "channel" | "remoteId"): string {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error(`Channel session ${label} must not be empty.`);
  }
  if (trimmed.includes(":")) {
    throw new Error(`Channel session ${label} must not contain ':'.`);
  }
  return trimmed;
}

export function formatChannelSessionId(channel: string, remoteId: string): string {
  return `${CHANNEL_SESSION_PREFIX}${normalizeKeyPart(channel, "channel")}:${
    normalizeKeyPart(remoteId, "remoteId")
  }`;
}
