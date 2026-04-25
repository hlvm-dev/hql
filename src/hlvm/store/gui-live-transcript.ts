/**
 * Runtime-owned live GUI transcript.
 *
 * This is the SSOT for what the macOS Siri-style surface should render now.
 * It is intentionally separate from durable conversation storage.
 */

import { pushSSEEvent } from "./sse-store.ts";
import type { SSEEvent } from "./types.ts";

export const GUI_LIVE_TRANSCRIPT_SESSION_ID = "__gui_live_transcript__";

export function pushGuiLiveTranscriptEvent(
  eventType: string,
  data: unknown,
): SSEEvent {
  return pushSSEEvent(GUI_LIVE_TRANSCRIPT_SESSION_ID, eventType, data);
}
