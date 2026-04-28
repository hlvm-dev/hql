/**
 * Companion trace sink (JSONL).
 *
 * Always-on for now to aid end-to-end debugging in desktop builds.
 */

import { appendJsonLine } from "../../common/jsonl.ts";
import { getHlvmDir } from "../../common/paths.ts";
import { getPlatform } from "../../platform/platform.ts";

const TRACE_FILE_NAME = "companion-trace.jsonl";

let tracePathCache: string | null = null;

export function getCompanionTracePath(): string {
  if (!tracePathCache) {
    tracePathCache = getPlatform().path.join(getHlvmDir(), TRACE_FILE_NAME);
  }
  return tracePathCache;
}

export function traceCompanion(
  stage: string,
  data?: Record<string, unknown>,
): void {
  // Best-effort only: tracing must never break companion flow.
  try {
    const record: Record<string, unknown> = {
      ts: new Date().toISOString(),
      stage,
    };
    if (data && Object.keys(data).length > 0) record.data = data;
    appendJsonLine(getCompanionTracePath(), record).catch(() => {});
  } catch { /* swallow */ }
}
