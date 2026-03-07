/**
 * Terminal Input Utilities
 *
 * Shared helpers for raw-mode terminal input across CLI commands.
 */

import { getPlatform } from "../../../platform/platform.ts";

/** Read a single keypress from raw-mode stdin. Returns lowercase character. */
export async function readSingleKey(): Promise<string> {
  const stdin = getPlatform().terminal.stdin;
  stdin.setRaw(true);
  try {
    const buf = new Uint8Array(1);
    const n = await stdin.read(buf);
    if (n === null || n === 0) return "";
    return String.fromCharCode(buf[0]).toLowerCase();
  } finally {
    stdin.setRaw(false);
  }
}

/** Read a full line from stdin until newline/return/EOF. */
export async function readLineInput(): Promise<string> {
  const stdin = getPlatform().terminal.stdin;
  const decoder = new TextDecoder();
  const chunks: string[] = [];

  while (true) {
    const buf = new Uint8Array(1);
    const n = await stdin.read(buf);
    if (n === null || n === 0) break;
    const char = decoder.decode(buf.subarray(0, n));
    if (char === "\n" || char === "\r") break;
    chunks.push(char);
  }

  return chunks.join("").trim();
}
