import { RuntimeError } from "../../../common/error.ts";
import { getRuntimeDir } from "../../../common/paths.ts";
import { getPlatform } from "../../../platform/platform.ts";
import { log } from "../../api/log.ts";

export interface IMessageWalWatcher {
  close(): void;
  done: Promise<void>;
}

export interface IMessageWalWatcherOptions {
  onChange: () => void | Promise<void>;
  onError?: (error: Error) => void;
}

const textDecoder = new TextDecoder();

export function startIMessageWalWatcher(
  walPath: string,
  options: IMessageWalWatcherOptions,
): IMessageWalWatcher {
  const platform = getPlatform();
  const sourcePath = platform.path.fromFileUrl(
    new URL("./wal-watcher.swift", import.meta.url),
  );
  const helperPath = ensureWalWatcherHelperFile(sourcePath);
  const moduleCachePath = getIMessageSwiftModuleCachePath();
  const process = platform.command.run({
    cmd: ["swift", helperPath, walPath],
    env: { CLANG_MODULE_CACHE_PATH: moduleCachePath },
    stdin: "null",
    stdout: "piped",
    stderr: "piped",
  });

  let closed = false;
  const stdoutDone = readHelperStdout(process.stdout, async () => {
    if (closed) return;
    await options.onChange();
  });
  const stderrDone = drainHelperStderr(process.stderr);
  const statusDone = process.status.then((status) => {
    if (!closed && !status.success) {
      options.onError?.(
        new RuntimeError(
          `iMessage WAL watcher exited with code ${status.code}`,
        ),
      );
    }
  });

  return {
    close(): void {
      if (closed) return;
      closed = true;
      try {
        process.kill?.("SIGTERM");
      } catch {
        // The helper may already have exited after a WAL rename/delete.
      }
    },
    done: Promise.all([stdoutDone, stderrDone, statusDone]).then(() => {}),
  };
}

function ensureWalWatcherHelperFile(sourcePath: string): string {
  const platform = getPlatform();
  const helperPath = platform.path.join(
    getRuntimeDir(),
    "imessage",
    "wal-watcher.swift",
  );

  try {
    const source = platform.fs.readTextFileSync(sourcePath);
    platform.fs.mkdirSync(platform.path.dirname(helperPath), {
      recursive: true,
    });
    platform.fs.writeTextFileSync(helperPath, source);
    return helperPath;
  } catch (error) {
    throw new RuntimeError(
      "iMessage WAL watcher helper is unavailable.",
      { originalError: error instanceof Error ? error : undefined },
    );
  }
}

function getIMessageSwiftModuleCachePath(): string {
  const platform = getPlatform();
  const cachePath = platform.path.join(
    getRuntimeDir(),
    "imessage",
    "swift-module-cache",
  );
  platform.fs.mkdirSync(cachePath, { recursive: true });
  return cachePath;
}

async function readHelperStdout(
  stream: unknown,
  onChange: () => Promise<void>,
): Promise<void> {
  if (!isReadableStream(stream)) {
    throw new RuntimeError("iMessage WAL watcher stdout is unavailable.");
  }

  const reader = stream.getReader();
  let buffer = "";
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) return;
      buffer += textDecoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.trim()) continue;
        await onChange();
      }
    }
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    log.ns("imessage").warn(`WAL watcher stdout failed: ${detail}`);
  } finally {
    reader.releaseLock();
  }
}

async function drainHelperStderr(stream: unknown): Promise<void> {
  if (!isReadableStream(stream)) return;
  const reader = stream.getReader();
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) return;
      const text = textDecoder.decode(value).trim();
      if (text) log.ns("imessage").debug(`[wal-watcher] ${text}`);
    }
  } catch {
    // Diagnostic stream only.
  } finally {
    reader.releaseLock();
  }
}

function isReadableStream(value: unknown): value is ReadableStream<Uint8Array> {
  return value instanceof ReadableStream;
}
