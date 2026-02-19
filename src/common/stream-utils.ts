/**
 * Stream Utilities — shared stream reading for agent tools (SSOT)
 *
 * Consolidates stream reading logic previously duplicated
 * across shell-tools.ts and git-tools.ts.
 */

/** Maximum bytes to read from a single process stream (10 MiB) */
const MAX_STREAM_BYTES = 10 * 1024 * 1024;

/** Concatenate an array of Uint8Arrays into a single Uint8Array */
export function concatUint8Arrays(chunks: Uint8Array[]): Uint8Array {
  if (chunks.length === 0) return new Uint8Array();
  if (chunks.length === 1) return chunks[0];

  const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const result = new Uint8Array(totalLength);
  let offset = 0;

  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }

  return result;
}

/**
 * Read a process stream to completion, returning the full content as bytes.
 *
 * @param stream - The stream to read (typically process.stdout or process.stderr)
 * @param signal - Optional abort signal to cancel reading
 * @param maxBytes - Maximum bytes to read (defaults to MAX_STREAM_BYTES)
 */
export async function readProcessStream(
  stream: unknown,
  signal?: AbortSignal,
  maxBytes: number = MAX_STREAM_BYTES,
): Promise<Uint8Array> {
  if (
    !stream ||
    typeof (stream as ReadableStream<Uint8Array>).getReader !== "function"
  ) {
    return new Uint8Array();
  }

  const reader = (stream as ReadableStream<Uint8Array>).getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;

  const onAbort = (): void => {
    reader.cancel().catch(() => {});
  };

  if (signal) {
    if (signal.aborted) {
      onAbort();
    } else {
      signal.addEventListener("abort", onAbort);
    }
  }

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        totalBytes += value.length;
        if (totalBytes > maxBytes) {
          const overshoot = totalBytes - maxBytes;
          const trimmed = value.slice(0, value.length - overshoot);
          if (trimmed.length > 0) chunks.push(trimmed);
          // Drain remaining stream to avoid broken pipe
          try {
            while (true) {
              const { done: d } = await reader.read();
              if (d) break;
            }
          } catch {
            // ignore drain errors
          }
          break;
        }
        chunks.push(value);
      }
    }
  } finally {
    if (signal) {
      signal.removeEventListener("abort", onAbort);
    }
    reader.releaseLock();
  }

  return concatUint8Arrays(chunks);
}
