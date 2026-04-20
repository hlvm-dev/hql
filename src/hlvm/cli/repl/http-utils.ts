/**
 * HTTP Utilities
 *
 * Shared request/response helpers used by both http-server.ts and route handlers.
 * Extracted from http-server.ts to enable reuse across handler modules.
 */

const MAX_BODY_BYTES = 1_000_000;
const textDecoder = new TextDecoder();
export const textEncoder = new TextEncoder();

type JsonParseResult<T> =
  | { ok: true; value: T }
  | { ok: false; response: Response };

export function jsonError(
  message: string,
  status: number,
  details: Record<string, unknown> = {},
): Response {
  return Response.json({ ...details, error: message }, { status });
}

export function jsonErrorFromDescribed(
  described: {
    message: string;
    class: string;
    retryable: boolean;
    hint: string | null;
  },
  status: number,
  extra: Record<string, unknown> = {},
): Response {
  return Response.json({
    ...extra,
    error: described.message,
    errorClass: described.class,
    retryable: described.retryable,
    hint: described.hint,
  }, { status });
}

export async function jsonErrorFromUnknown(
  error: unknown,
  status: number,
): Promise<Response> {
  const { describeErrorForDisplay } = await import(
    "../../agent/error-taxonomy.ts"
  );
  const described = await describeErrorForDisplay(error);
  return jsonErrorFromDescribed(described, status);
}

/** Check if origin is a localhost variant (http://localhost:* or http://127.0.0.1:*) */
function isLocalhostOrigin(origin: string): boolean {
  if (!origin) return false;
  try {
    const url = new URL(origin);
    return url.hostname === "localhost" || url.hostname === "127.0.0.1";
  } catch {
    return false;
  }
}

export function addCorsHeaders(response: Response, origin?: string): Response {
  if (origin && isLocalhostOrigin(origin)) {
    response.headers.set("Access-Control-Allow-Origin", origin);
  }
  response.headers.set("Vary", "Origin");
  response.headers.set("Access-Control-Allow-Methods", "GET, POST, PATCH, DELETE, OPTIONS");
  response.headers.set("Access-Control-Allow-Headers", "Content-Type, X-Request-ID, Last-Event-ID, Authorization");
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

/** Format an SSE event with id, event type, and JSON data */
export function formatSSE(event: { id: string | number; event_type: string; data: unknown }): string {
  return `id: ${event.id}\nevent: ${event.event_type}\ndata: ${JSON.stringify(event.data)}\n\n`;
}

/**
 * Create an SSE Response with heartbeat and abort cleanup.
 *
 * The `setup` callback receives an `emit(chunk)` function to push raw SSE text
 * and returns an optional cleanup function (e.g. unsubscribe).
 */
export function createSSEResponse(
  req: Request,
  setup: (emit: (chunk: string) => void) => (() => void) | void,
): Response {
  const stream = new ReadableStream({
    start(controller) {
      let closed = false;
      let teardown: (() => void) | void;
      let heartbeat: ReturnType<typeof setInterval> | undefined;

      function cleanup(): void {
        if (closed) return;
        closed = true;
        req.signal.removeEventListener("abort", cleanup);
        teardown?.();
        if (heartbeat !== undefined) {
          clearInterval(heartbeat);
        }
        try {
          controller.close();
        } catch {
          // Already closed
        }
      }

      const emit = (chunk: string): void => {
        if (closed) return;
        try {
          controller.enqueue(textEncoder.encode(chunk));
        } catch {
          cleanup();
        }
      };

      req.signal.addEventListener("abort", cleanup, { once: true });
      if (req.signal.aborted) {
        cleanup();
        return;
      }

      emit("retry: 3000\n\n");
      if (closed) {
        return;
      }

      teardown = setup(emit);
      if (closed) {
        return;
      }

      heartbeat = setInterval(() => {
        if (closed) return;
        try {
          controller.enqueue(textEncoder.encode(": heartbeat\n\n"));
        } catch {
          cleanup();
        }
      }, 30_000);
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive",
    },
  });
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
