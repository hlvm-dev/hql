import {
  getSession,
  updateSession,
} from "./conversation-store.ts";
import type { SessionRow } from "./types.ts";

type SessionMetadataRecord = Record<string, unknown>;

export function parseSessionMetadata(
  metadata: string | null | undefined,
): SessionMetadataRecord {
  if (!metadata) return {};
  try {
    const parsed = JSON.parse(metadata);
    return parsed && typeof parsed === "object"
      ? parsed as SessionMetadataRecord
      : {};
  } catch {
    return {};
  }
}

function stringifySessionMetadata(
  metadata: SessionMetadataRecord,
): string | null {
  const entries = Object.entries(metadata).filter(([, value]) =>
    value !== undefined
  );
  if (entries.length === 0) return null;
  return JSON.stringify(Object.fromEntries(entries));
}

export function updateSessionMetadata(
  sessionId: string,
  mutate: (metadata: SessionMetadataRecord) => void,
): SessionRow | null {
  const session = getSession(sessionId);
  if (!session) return null;
  const metadata = parseSessionMetadata(session.metadata);
  mutate(metadata);
  return updateSession(sessionId, {
    metadata: stringifySessionMetadata(metadata),
  });
}
