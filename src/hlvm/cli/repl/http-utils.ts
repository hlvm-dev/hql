/**
 * HTTP Utilities
 *
 * Shared request/response helpers used by both http-server.ts and route handlers.
 * Extracted from http-server.ts to enable reuse across handler modules.
 */

const MAX_BODY_BYTES = 1_000_000;
const textDecoder = new TextDecoder();

export type JsonParseResult<T> =
  | { ok: true; value: T }
  | { ok: false; response: Response };

export function jsonError(message: string, status: number): Response {
  return Response.json({ error: message }, { status });
}

export function addCorsHeaders(response: Response): Response {
  response.headers.set("Access-Control-Allow-Origin", "*");
  response.headers.set("Access-Control-Allow-Methods", "GET, POST, PATCH, DELETE, OPTIONS");
  response.headers.set("Access-Control-Allow-Headers", "Content-Type, X-Request-ID, Last-Event-ID");
  return response;
}

export function ndjsonLine(obj: unknown): string {
  return JSON.stringify(obj) + "\n";
}

async function readBodyWithLimit(req: Request, limit: number): Promise<
  { ok: true; bytes: Uint8Array } | { ok: false; response: Response }
> {
  if (!req.body) {
    return { ok: false, response: jsonError("Missing body", 400) };
  }

  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    if (!value) continue;
    total += value.byteLength;
    if (total > limit) {
      await reader.cancel();
      return { ok: false, response: jsonError("Request too large", 413) };
    }
    chunks.push(value);
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return { ok: true, bytes };
}

export async function parseJsonBody<T>(req: Request): Promise<JsonParseResult<T>> {
  const contentType = req.headers.get("content-type");
  if (contentType && !contentType.includes("application/json")) {
    return { ok: false, response: jsonError("Content-Type must be application/json", 400) };
  }

  const contentLength = req.headers.get("content-length");
  if (contentLength) {
    const length = Number.parseInt(contentLength, 10);
    if (Number.isFinite(length) && length > MAX_BODY_BYTES) {
      return { ok: false, response: jsonError("Request too large", 413) };
    }
  }

  const bodyResult = await readBodyWithLimit(req, MAX_BODY_BYTES);
  if (!bodyResult.ok) return bodyResult;
  if (bodyResult.bytes.length === 0) {
    return { ok: false, response: jsonError("Missing body", 400) };
  }

  try {
    const text = textDecoder.decode(bodyResult.bytes);
    return { ok: true, value: JSON.parse(text) as T };
  } catch {
    return { ok: false, response: jsonError("Invalid JSON", 400) };
  }
}
