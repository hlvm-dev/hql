import { RuntimeError } from "./error.ts";

export async function writeToProcessStdin(
  stdin: unknown,
  payload: Uint8Array,
): Promise<void> {
  if (!stdin) {
    throw new RuntimeError("Process stdin is unavailable");
  }

  if (typeof (stdin as WritableStream<Uint8Array>).getWriter === "function") {
    const writer = (stdin as WritableStream<Uint8Array>).getWriter();
    try {
      await writer.write(payload);
    } finally {
      writer.releaseLock();
    }
    return;
  }

  if (typeof (stdin as { write?: unknown }).write === "function") {
    await new Promise<void>((resolve, reject) => {
      const stream = stdin as {
        write: (
          chunk: Uint8Array,
          callback?: (error?: Error | null) => void,
        ) => boolean;
      };
      const callback = (error?: Error | null) =>
        error ? reject(error) : resolve();
      stream.write(payload, callback);
    });
    return;
  }

  throw new RuntimeError("Unsupported process stdin stream");
}

export async function closeProcessStdin(stdin: unknown): Promise<void> {
  if (!stdin) return;

  if (typeof (stdin as WritableStream<Uint8Array>).getWriter === "function") {
    const writer = (stdin as WritableStream<Uint8Array>).getWriter();
    try {
      await writer.close();
    } catch {
      // Ignore already-closed streams.
    } finally {
      writer.releaseLock();
    }
    return;
  }

  if (typeof (stdin as { end?: unknown }).end === "function") {
    await new Promise<void>((resolve) => {
      const stream = stdin as { end: (callback?: () => void) => void };
      try {
        stream.end(() => resolve());
      } catch {
        resolve();
      }
    });
  }
}
