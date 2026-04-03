import { createHash } from "node:crypto";
import { TEXT_ENCODER } from "./utils.ts";
import { bytesToHex } from "./hash.ts";

function toSha256Input(value: string | Uint8Array): Uint8Array {
  return typeof value === "string" ? TEXT_ENCODER.encode(value) : value;
}

export async function sha256Hex(
  value: string | Uint8Array,
): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", toSha256Input(value));
  return bytesToHex(new Uint8Array(digest));
}

export function sha256HexSync(
  value: string | Uint8Array,
): string {
  return createHash("sha256").update(toSha256Input(value)).digest("hex");
}
