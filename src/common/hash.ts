/**
 * FNV-1a 32-bit hash — fast, deterministic, no crypto dependency.
 * Used for cache keys and prompt signatures (change detection, not security).
 */
function fnv1a(input: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/** FNV-1a hash returning a zero-padded 8-char hex string. */
export function fnv1aHex(input: string): string {
  return fnv1a(input).toString(16).padStart(8, "0");
}

/** Pre-built hex lookup table — avoids per-byte toString(16) + padStart. */
const HEX_TABLE: readonly string[] = Array.from(
  { length: 256 },
  (_, i) => i.toString(16).padStart(2, "0"),
);

/**
 * Convert a Uint8Array to a hex string using a pre-built lookup table.
 * ~3x faster than Array.from(bytes).map(b => b.toString(16).padStart(2,"0")).join("").
 */
export function bytesToHex(bytes: Uint8Array): string {
  let hex = "";
  for (let i = 0; i < bytes.length; i++) {
    hex += HEX_TABLE[bytes[i]];
  }
  return hex;
}
