#!/usr/bin/env -S deno run --quiet

import { getPlatform } from "../../src/platform/platform.ts";

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const HEADER_DELIMITER = encoder.encode("\r\n\r\n");

let buffer: Uint8Array<ArrayBufferLike> = new Uint8Array();
let shouldExit = false;
const CRASH_ONCE_MARKER = ".fixture-lsp-crash-once";

function appendBytes(
  left: Uint8Array<ArrayBufferLike>,
  right: Uint8Array<ArrayBufferLike>,
): Uint8Array<ArrayBufferLike> {
  if (left.length === 0) return right;
  if (right.length === 0) return left;
  const merged = new Uint8Array(left.length + right.length);
  merged.set(left, 0);
  merged.set(right, left.length);
  return merged;
}

function findHeaderBoundary(bytes: Uint8Array<ArrayBufferLike>): number {
  if (bytes.length < HEADER_DELIMITER.length) return -1;
  for (let i = 0; i <= bytes.length - HEADER_DELIMITER.length; i++) {
    let matched = true;
    for (let j = 0; j < HEADER_DELIMITER.length; j++) {
      if (bytes[i + j] !== HEADER_DELIMITER[j]) {
        matched = false;
        break;
      }
    }
    if (matched) return i;
  }
  return -1;
}

function parseContentLength(headers: string): number | null {
  const match = /content-length:\s*(\d+)/i.exec(headers);
  if (!match) return null;
  const value = Number(match[1]);
  return Number.isFinite(value) ? value : null;
}

function writeMessage(message: unknown): void {
  const body = encoder.encode(JSON.stringify(message));
  const header = encoder.encode(
    `Content-Length: ${body.length}\r\nContent-Type: application/vscode-jsonrpc; charset=utf-8\r\n\r\n`,
  );
  getPlatform().terminal.stdout.writeSync(header);
  getPlatform().terminal.stdout.writeSync(body);
}

function buildDiagnostics(text: string) {
  const diagnostics: unknown[] = [];
  if (text.includes("missingName")) {
    diagnostics.push({
      range: {
        start: { line: 0, character: 0 },
        end: { line: 0, character: 11 },
      },
      severity: 1,
      code: "TS2304",
      source: "fixture-lsp",
      message: "Cannot find name 'missingName'.",
    });
  }
  if (text.includes("warnMe")) {
    diagnostics.push({
      range: {
        start: { line: 0, character: 0 },
        end: { line: 0, character: 6 },
      },
      severity: 2,
      code: "W0001",
      source: "fixture-lsp",
      message: "Synthetic warning.",
    });
  }
  return diagnostics;
}

async function publishDiagnostics(
  uri: string,
  version: number,
  text: string,
): Promise<void> {
  if (text.includes("restartOnce")) {
    const markerPath = getPlatform().path.join(Deno.cwd(), CRASH_ONCE_MARKER);
    const alreadyCrashed = await getPlatform().fs.exists(markerPath);
    if (!alreadyCrashed) {
      await getPlatform().fs.writeTextFile(markerPath, "crashed\n");
      throw new Error("fixture-lsp crashed before publishing diagnostics");
    }
  }
  if (text.includes("delayedMissingName")) {
    writeMessage({
      jsonrpc: "2.0",
      method: "textDocument/publishDiagnostics",
      params: {
        uri,
        version,
        diagnostics: [],
      },
    });
    setTimeout(() => {
      writeMessage({
        jsonrpc: "2.0",
        method: "textDocument/publishDiagnostics",
        params: {
          uri,
          version,
          diagnostics: [{
            range: {
              start: { line: 0, character: 0 },
              end: { line: 0, character: 18 },
            },
            severity: 1,
            code: "TS2304",
            source: "fixture-lsp",
            message: "Cannot find name 'delayedMissingName'.",
          }],
        },
      });
    }, 50);
    return;
  }
  writeMessage({
    jsonrpc: "2.0",
    method: "textDocument/publishDiagnostics",
    params: {
      uri,
      version,
      diagnostics: buildDiagnostics(text),
    },
  });
}

async function handleMessage(message: unknown): Promise<void> {
  if (
    !message ||
    typeof message !== "object" ||
    Array.isArray(message) ||
    typeof (message as Record<string, unknown>).method !== "string"
  ) {
    return;
  }

  const rpc = message as Record<string, unknown>;
  const method = rpc.method as string;
  const id = typeof rpc.id === "number" ? rpc.id : undefined;
  const params = rpc.params && typeof rpc.params === "object"
    ? rpc.params as Record<string, unknown>
    : {};

  switch (method) {
    case "initialize":
      writeMessage({
        jsonrpc: "2.0",
        id,
        result: {
          capabilities: {
            textDocumentSync: 1,
          },
          serverInfo: {
            name: "fixture-lsp",
            version: "0.1.0",
          },
        },
      });
      return;
    case "shutdown":
      writeMessage({ jsonrpc: "2.0", id, result: {} });
      return;
    case "exit":
      shouldExit = true;
      return;
    case "textDocument/didOpen": {
      const document = params.textDocument as
        | Record<string, unknown>
        | undefined;
      if (!document) return;
      await publishDiagnostics(
        String(document.uri ?? ""),
        Number(document.version ?? 1),
        String(document.text ?? ""),
      );
      return;
    }
    case "textDocument/didChange": {
      const document = params.textDocument as
        | Record<string, unknown>
        | undefined;
      const changes = Array.isArray(params.contentChanges)
        ? params.contentChanges as Array<Record<string, unknown>>
        : [];
      await publishDiagnostics(
        String(document?.uri ?? ""),
        Number(document?.version ?? 1),
        String(changes[0]?.text ?? ""),
      );
      return;
    }
    default:
      if (id !== undefined) {
        writeMessage({ jsonrpc: "2.0", id, result: {} });
      }
  }
}

while (!shouldExit) {
  const chunk = new Uint8Array(4096);
  const bytesRead = await getPlatform().terminal.stdin.read(chunk);
  if (bytesRead === null) break;
  if (bytesRead === 0) continue;
  buffer = appendBytes(buffer, chunk.slice(0, bytesRead));

  while (true) {
    const boundary = findHeaderBoundary(buffer);
    if (boundary < 0) break;
    const headers = decoder.decode(buffer.slice(0, boundary));
    const contentLength = parseContentLength(headers);
    if (contentLength === null) {
      shouldExit = true;
      break;
    }
    const start = boundary + HEADER_DELIMITER.length;
    if (buffer.length < start + contentLength) break;
    const body = buffer.slice(start, start + contentLength);
    buffer = buffer.slice(start + contentLength);
    await handleMessage(JSON.parse(decoder.decode(body)));
  }
}
