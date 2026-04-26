import { RuntimeError } from "../../../common/error.ts";
import { getRuntimeDir } from "../../../common/paths.ts";
import { getPlatform } from "../../../platform/platform.ts";

export interface IMessageAttributedBodyDecoder {
  decode(data: Uint8Array): Promise<string>;
}

const textDecoder = new TextDecoder();

export function createFoundationAttributedBodyDecoder(): IMessageAttributedBodyDecoder {
  return {
    async decode(data: Uint8Array): Promise<string> {
      if (data.length === 0) return "";
      const platform = getPlatform();
      const helperPath = ensureAttributedBodyDecoderHelperFile();
      const moduleCachePath = getIMessageSwiftModuleCachePath();
      const process = platform.command.run({
        cmd: ["swift", helperPath],
        env: { CLANG_MODULE_CACHE_PATH: moduleCachePath },
        stdin: "piped",
        stdout: "piped",
        stderr: "piped",
        timeout: 5_000,
      });

      const [stdout, stderr, status] = await Promise.all([
        readAll(process.stdout),
        readAll(process.stderr),
        writeAll(process.stdin, data).then(() => process.status),
      ]);

      if (status.success) return textDecoder.decode(stdout).trim();
      const detail = textDecoder.decode(stderr).trim() ||
        `decoder exited with code ${status.code}`;
      throw new RuntimeError(
        `iMessage attributedBody decode failed: ${detail}`,
      );
    },
  };
}

function ensureAttributedBodyDecoderHelperFile(): string {
  const platform = getPlatform();
  const sourcePath = platform.path.fromFileUrl(
    new URL("./attributed-body-decoder.swift", import.meta.url),
  );
  const helperPath = platform.path.join(
    getRuntimeDir(),
    "imessage",
    "attributed-body-decoder.swift",
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
      "iMessage attributedBody decoder helper is unavailable.",
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

async function writeAll(stream: unknown, data: Uint8Array): Promise<void> {
  if (!(stream instanceof WritableStream)) {
    throw new RuntimeError(
      "iMessage attributedBody decoder stdin is unavailable.",
    );
  }
  const writer = stream.getWriter();
  try {
    await writer.write(data);
    await writer.close();
  } finally {
    writer.releaseLock();
  }
}

async function readAll(stream: unknown): Promise<Uint8Array> {
  if (!(stream instanceof ReadableStream)) {
    throw new RuntimeError(
      "iMessage attributedBody decoder stream is unavailable.",
    );
  }
  const chunks: Uint8Array[] = [];
  const reader = stream.getReader();
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const out = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}
