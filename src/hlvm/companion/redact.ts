/**
 * Companion Agent — Observation Redaction
 *
 * Deterministic PII filter. Uses sanitizeSensitiveContent from memory barrel.
 */

import type { Observation } from "./types.ts";
import { sanitizeSensitiveContent } from "../memory/mod.ts";

const MAX_STRING_LENGTH = 500;
const MAX_CLIPBOARD_LENGTH = 200;

/** DJB2 hash, base36 encoded. */
function simpleHash(str: string): string {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) + hash + str.charCodeAt(i)) | 0;
  }
  return (hash >>> 0).toString(36);
}

function redactString(value: string, isClipboard: boolean): string {
  const { sanitized } = sanitizeSensitiveContent(value);
  const limit = isClipboard ? MAX_CLIPBOARD_LENGTH : MAX_STRING_LENGTH;
  if (sanitized.length > limit) {
    return sanitized.slice(0, limit) + `...[${simpleHash(sanitized)}]`;
  }
  return sanitized;
}

function redactValue(value: unknown, isClipboard: boolean): unknown {
  if (typeof value === "string") return redactString(value, isClipboard);
  if (Array.isArray(value)) return value.map((v) => redactValue(v, isClipboard));
  if (value !== null && typeof value === "object") {
    const result: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      result[k] = redactValue(v, isClipboard);
    }
    return result;
  }
  return value;
}

/** Returns a sanitized copy — never mutates the input. */
export function redactObservation(obs: Observation): Observation {
  return {
    ...obs,
    data: redactValue(obs.data, obs.kind === "clipboard.changed") as Record<
      string,
      unknown
    >,
  };
}
