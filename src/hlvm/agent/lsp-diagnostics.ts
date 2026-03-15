/**
 * LSP diagnostics runtime for post-write verification.
 *
 * Implements a diagnostics-only Language Server Protocol client over stdio.
 * The runtime is session-scoped so language servers stay warm across tool calls.
 */

import {
  type PlatformCommandProcess,
  getPlatform,
} from "../../platform/platform.ts";
import { readProcessStream } from "../../common/stream-utils.ts";
import {
  TimeoutError,
  withTimeout,
} from "../../common/timeout-utils.ts";
import { closeProcessStdin, writeToProcessStdin } from "../../common/process-io.ts";
import {
  getErrorMessage,
  isObjectValue,
  truncate,
} from "../../common/utils.ts";
import { RuntimeError } from "../../common/error.ts";
import { getAgentLogger } from "./logger.ts";

const HEADER_DELIMITER = new TextEncoder().encode("\r\n\r\n");
const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

const INITIALIZE_TIMEOUT_MS = 5000;
const DIAGNOSTICS_TIMEOUT_MS = 2500;
const DIAGNOSTICS_SETTLE_MS = 150;
const EMPTY_DIAGNOSTICS_SETTLE_MS = 700;
const SHUTDOWN_TIMEOUT_MS = 750;
const MAX_DIAGNOSTICS_TEXT = 1400;
const MAX_DIAGNOSTIC_COUNT = 8;
const MAX_STDERR_PREVIEW = 400;

type LspSeverity = 1 | 2 | 3 | 4;

export interface WriteVerificationResult {
  ok: boolean;
  source: "lsp" | "syntax";
  verifier: string;
  summary: string;
  diagnostics?: string;
}

export interface LspServerCandidate {
  key: string;
  label: string;
  command: string[];
  languageId: string;
  settings?: Record<string, unknown>;
  diagnosticsTimeoutMs?: number;
}

interface DiagnosticLocation {
  line: number;
  character: number;
}

interface LspDiagnostic {
  message: string;
  severity?: LspSeverity;
  code?: string | number;
  source?: string;
  range?: {
    start?: Partial<DiagnosticLocation>;
    end?: Partial<DiagnosticLocation>;
  };
}

interface PublishDiagnosticsMessage {
  uri: string;
  diagnostics: LspDiagnostic[];
  version?: number;
}

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (error: unknown) => void;
}

interface PendingDiagnosticsWaiter {
  version: number;
  minSequence: number;
  consume: (value: PublishDiagnosticsMessage) => void;
  reject: (error: unknown) => void;
  cleanup: () => void;
}

interface OpenDocumentState {
  version: number;
}

export interface LspDiagnosticsRuntime {
  verifyFile(
    filePath: string,
    signal?: AbortSignal,
  ): Promise<WriteVerificationResult | null>;
  dispose(): Promise<void>;
}

interface LspDiagnosticsRuntimeOptions {
  workspace: string;
  resolveCandidates?: (
    filePath: string,
    workspace: string,
  ) => Promise<LspServerCandidate[]>;
}

export async function resolveDefaultLspCandidates(
  filePath: string,
  workspace: string,
): Promise<LspServerCandidate[]> {
  const platform = getPlatform();
  const ext = platform.path.extname(filePath).toLowerCase();
  const [hasDenoJson, hasDenoJsonc] = await Promise.all([
    platform.fs.exists(platform.path.join(workspace, "deno.json")),
    platform.fs.exists(platform.path.join(workspace, "deno.jsonc")),
  ]);
  const hasDenoConfig = hasDenoJson || hasDenoJsonc;

  switch (ext) {
    case ".ts":
    case ".mts":
    case ".cts":
      return buildTypeScriptCandidates("typescript", hasDenoConfig);
    case ".tsx":
      return buildTypeScriptCandidates("typescriptreact", hasDenoConfig);
    case ".js":
    case ".mjs":
    case ".cjs":
      return buildTypeScriptCandidates("javascript", hasDenoConfig);
    case ".jsx":
      return buildTypeScriptCandidates("javascriptreact", hasDenoConfig);
    case ".py":
      return [
        candidate("pyright-langserver --stdio", ["pyright-langserver", "--stdio"], "python"),
        candidate("pylsp", ["pylsp"], "python"),
      ];
    case ".rs":
      return [candidate("rust-analyzer", ["rust-analyzer"], "rust")];
    case ".go":
      return [candidate("gopls", ["gopls"], "go")];
    default:
      return [];
  }
}

function buildTypeScriptCandidates(
  languageId: string,
  hasDenoConfig: boolean,
): LspServerCandidate[] {
  const candidates: LspServerCandidate[] = [];
  if (hasDenoConfig) {
    candidates.push(candidate(
      "deno lsp",
      ["deno", "lsp"],
      languageId,
      { deno: { enable: true, lint: true } },
    ));
  }
  candidates.push(
    candidate("typescript-language-server --stdio", [
      "typescript-language-server",
      "--stdio",
    ], languageId, undefined, 5000),
    candidate("vtsls --stdio", ["vtsls", "--stdio"], languageId, undefined, 5000),
  );
  return candidates;
}

function candidate(
  label: string,
  command: string[],
  languageId: string,
  settings?: Record<string, unknown>,
  diagnosticsTimeoutMs?: number,
): LspServerCandidate {
  return {
    key: command.join("\u0000"),
    label,
    command,
    languageId,
    settings,
    diagnosticsTimeoutMs,
  };
}

function appendBytes(
  left: Uint8Array<ArrayBufferLike>,
  right: Uint8Array<ArrayBufferLike>,
): Uint8Array<ArrayBufferLike> {
  if (left.length === 0) return right;
  if (right.length === 0) return left;
  const buffer = new Uint8Array(left.length + right.length);
  buffer.set(left, 0);
  buffer.set(right, left.length);
  return buffer;
}

function findHeaderBoundary(buffer: Uint8Array<ArrayBufferLike>): number {
  if (buffer.length < HEADER_DELIMITER.length) return -1;
  for (let i = 0; i <= buffer.length - HEADER_DELIMITER.length; i++) {
    let matched = true;
    for (let j = 0; j < HEADER_DELIMITER.length; j++) {
      if (buffer[i + j] !== HEADER_DELIMITER[j]) {
        matched = false;
        break;
      }
    }
    if (matched) return i;
  }
  return -1;
}

function parseContentLength(headerText: string): number | null {
  const match = /content-length:\s*(\d+)/i.exec(headerText);
  if (!match) return null;
  const value = Number(match[1]);
  return Number.isFinite(value) && value >= 0 ? value : null;
}

function severityRank(severity?: LspSeverity): number {
  return severity ?? 4;
}

function severityLabel(severity?: LspSeverity): string {
  switch (severity) {
    case 1:
      return "ERROR";
    case 2:
      return "WARN";
    case 3:
      return "INFO";
    case 4:
    default:
      return "HINT";
  }
}

function isLspDiagnostic(value: unknown): value is LspDiagnostic {
  return isObjectValue(value) && typeof value.message === "string";
}

function isPublishDiagnosticsMessage(value: unknown): value is PublishDiagnosticsMessage {
  if (!isObjectValue(value) || typeof value.uri !== "string") return false;
  return Array.isArray(value.diagnostics) && value.diagnostics.every(isLspDiagnostic);
}

function formatDiagnosticLine(diagnostic: LspDiagnostic): string {
  const start = diagnostic.range?.start;
  const line = typeof start?.line === "number" ? start.line + 1 : 0;
  const character = typeof start?.character === "number" ? start.character + 1 : 0;
  const location = line > 0 && character > 0 ? ` ${line}:${character}` : "";
  const code = diagnostic.code !== undefined ? ` ${String(diagnostic.code)}` : "";
  const source = typeof diagnostic.source === "string" && diagnostic.source.trim().length > 0
    ? ` (${diagnostic.source.trim()})`
    : "";
  return `${severityLabel(diagnostic.severity)}${location}${code}${source} ${diagnostic.message.trim()}`;
}

function summarizeDiagnostics(
  serverLabel: string,
  diagnostics: LspDiagnostic[],
): WriteVerificationResult {
  const ordered = [...diagnostics].sort((left, right) =>
    severityRank(left.severity) - severityRank(right.severity)
  );
  // Single-pass severity counts instead of 4 separate filter passes
  let errors = 0, warnings = 0, infos = 0, hints = 0;
  for (const item of ordered) {
    switch (severityRank(item.severity)) {
      case 1: errors++; break;
      case 2: warnings++; break;
      case 3: infos++; break;
      default: hints++; break;
    }
  }

  if (ordered.length === 0) {
    return {
      ok: true,
      source: "lsp",
      verifier: serverLabel,
      summary: `LSP diagnostics passed via ${serverLabel}.`,
    };
  }

  const parts: string[] = [];
  if (errors > 0) parts.push(`${errors} error${errors === 1 ? "" : "s"}`);
  if (warnings > 0) parts.push(`${warnings} warning${warnings === 1 ? "" : "s"}`);
  if (infos > 0) parts.push(`${infos} info`);
  if (hints > 0) parts.push(`${hints} hint${hints === 1 ? "" : "s"}`);

  const lines = ordered.slice(0, MAX_DIAGNOSTIC_COUNT).map(formatDiagnosticLine);
  if (ordered.length > MAX_DIAGNOSTIC_COUNT) {
    lines.push(`... ${ordered.length - MAX_DIAGNOSTIC_COUNT} more diagnostics omitted`);
  }

  return {
    ok: errors === 0,
    source: "lsp",
    verifier: serverLabel,
    summary: `LSP diagnostics via ${serverLabel} found ${parts.join(", ")}.`,
    diagnostics: truncate(lines.join("\n"), MAX_DIAGNOSTICS_TEXT),
  };
}

function toAbsolutePath(filePath: string, workspace: string): string {
  const platform = getPlatform();
  return platform.path.isAbsolute(filePath)
    ? platform.path.normalize(filePath)
    : platform.path.normalize(platform.path.join(workspace, filePath));
}

function resolveSettingsValue(
  settings: Record<string, unknown> | undefined,
  section: string | undefined,
): unknown {
  if (!settings) return null;
  if (!section) return settings;

  const parts = section.split(".");
  let current: unknown = settings;
  for (const part of parts) {
    if (!isObjectValue(current)) return null;
    current = current[part];
  }
  return current ?? null;
}

class LspSession {
  private readonly workspaceUri: string;
  private readonly pendingRequests = new Map<number, PendingRequest>();
  private readonly diagnosticWaiters = new Map<string, PendingDiagnosticsWaiter[]>();
  private readonly documents = new Map<string, OpenDocumentState>();
  private readonly stderrTextPromise: Promise<string>;
  private readonly processExitPromise: Promise<void>;
  private processClosedError: Error | null = null;
  private readonly process: PlatformCommandProcess;
  private readonly stdoutReader: ReadableStreamDefaultReader<Uint8Array>;
  private readBuffer: Uint8Array<ArrayBufferLike> = new Uint8Array();
  private nextRequestId = 1;
  private diagnosticsSequence = 0;
  private disposed = false;

  private constructor(
    private readonly candidate: LspServerCandidate,
    private readonly workspace: string,
  ) {
    const platform = getPlatform();
    this.workspaceUri = String(platform.path.toFileUrl(workspace));
    this.process = platform.command.run({
      cmd: candidate.command,
      cwd: workspace,
      stdin: "piped",
      stdout: "piped",
      stderr: "piped",
    });

    if (
      typeof (this.process.stdout as ReadableStream<Uint8Array> | undefined)?.getReader !==
        "function"
    ) {
      throw new RuntimeError("LSP process stdout is unavailable");
    }

    this.stdoutReader = (this.process.stdout as ReadableStream<Uint8Array>).getReader();
    this.stderrTextPromise = readProcessStream(this.process.stderr)
      .then((bytes) => textDecoder.decode(bytes).trim())
      .catch(() => "");
    this.processExitPromise = this.process.status.then(async (status) => {
      if (this.processClosedError) return;
      const stderrText = await this.stderrTextPromise.catch(() => "");
      const statusText = status.signal
        ? `${status.code} (${String(status.signal)})`
        : String(status.code);
      const detail = stderrText
        ? `: ${truncate(stderrText.replace(/\s+/g, " ").trim(), MAX_STDERR_PREVIEW)}`
        : "";
      this.failAll(
        new Error(
          `LSP server exited (${this.candidate.label}, status ${statusText})${detail}`,
        ),
      );
    });
  }

  static async create(
    candidate: LspServerCandidate,
    workspace: string,
  ): Promise<LspSession> {
    const session = new LspSession(candidate, workspace);
    try {
      await session.initialize();
      return session;
    } catch (error) {
      await session.dispose();
      throw error;
    }
  }

  get isClosed(): boolean {
    return this.processClosedError !== null || this.disposed;
  }

  async verifyDocument(
    filePath: string,
    signal?: AbortSignal,
  ): Promise<WriteVerificationResult> {
    this.throwIfClosed();

    const platform = getPlatform();
    const absolutePath = toAbsolutePath(filePath, this.workspace);
    const uri = String(platform.path.toFileUrl(absolutePath));
    const text = await platform.fs.readTextFile(absolutePath);
    const current = this.documents.get(uri);
    const nextVersion = (current?.version ?? 0) + 1;
    const waitPromise = this.waitForDiagnostics(uri, nextVersion, signal);

    if (current) {
      current.version = nextVersion;
      await this.sendNotification("textDocument/didChange", {
        textDocument: { uri, version: nextVersion },
        contentChanges: [{ text }],
      });
    } else {
      this.documents.set(uri, { version: nextVersion });
      await this.sendNotification("textDocument/didOpen", {
        textDocument: {
          uri,
          languageId: this.candidate.languageId,
          version: nextVersion,
          text,
        },
      });
    }
    await this.sendNotification("textDocument/didSave", {
      textDocument: { uri },
    });

    const published = await waitPromise;
    return summarizeDiagnostics(this.candidate.label, published.diagnostics);
  }

  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    const alreadyClosed = this.processClosedError !== null;

    try {
      if (!alreadyClosed) {
        await withTimeout(
          async () => {
            try {
              await this.sendRequest("shutdown", null);
            } catch {
              // ignore best-effort shutdown errors
            }
          },
          { timeoutMs: SHUTDOWN_TIMEOUT_MS, label: "LSP shutdown" },
        );
      }
    } catch {
      // ignore
    }

    try {
      if (!alreadyClosed) {
        await this.sendNotification("exit", null);
      }
    } catch {
      // ignore
    }

    try {
      await closeProcessStdin(this.process.stdin);
    } catch {
      // ignore
    }

    try {
      this.process.kill?.("SIGTERM");
    } catch {
      // ignore
    }

    this.failAll(new Error(`LSP session disposed (${this.candidate.label})`));

    try {
      await withTimeout(
        async () => {
          await this.processExitPromise;
        },
        { timeoutMs: SHUTDOWN_TIMEOUT_MS, label: "LSP dispose wait" },
      );
    } catch {
      // ignore
    }

    try {
      this.stdoutReader.releaseLock();
    } catch {
      // ignore
    }
  }

  private async initialize(): Promise<void> {
    void this.readMessages();

    try {
      await withTimeout(
        async () => {
          await this.sendRequest("initialize", {
            processId: null,
            clientInfo: { name: "hlvm", version: "0.1.0" },
            rootUri: this.workspaceUri,
            workspaceFolders: [{
              uri: this.workspaceUri,
              name: getPlatform().path.basename(this.workspace),
            }],
            capabilities: {
              textDocument: {
                synchronization: {
                  dynamicRegistration: false,
                  willSave: false,
                  willSaveWaitUntil: false,
                  didSave: true,
                },
                publishDiagnostics: {
                  relatedInformation: true,
                  codeDescriptionSupport: true,
                  dataSupport: true,
                },
              },
              workspace: {
                configuration: true,
                workspaceFolders: true,
              },
              window: {
                workDoneProgress: true,
              },
            },
          });
        },
        { timeoutMs: INITIALIZE_TIMEOUT_MS, label: "LSP initialize" },
      );
      await this.sendNotification("initialized", {});
      if (this.candidate.settings) {
        await this.sendNotification("workspace/didChangeConfiguration", {
          settings: this.candidate.settings,
        });
      }
    } catch (error) {
      const stderrText = await this.stderrTextPromise.catch(() => "");
      const suffix = stderrText
        ? `: ${truncate(stderrText.replace(/\s+/g, " ").trim(), MAX_STDERR_PREVIEW)}`
        : "";
      throw new RuntimeError(
        `Failed to initialize ${this.candidate.label}: ${getErrorMessage(error)}${suffix}`,
      );
    }
  }

  private async readMessages(): Promise<void> {
    try {
      while (true) {
        const { done, value } = await this.stdoutReader.read();
        if (done) break;
        if (!value || value.length === 0) continue;
        this.readBuffer = appendBytes(this.readBuffer, value);
        await this.processBufferedMessages();
      }
    } catch (error) {
      this.failAll(new Error(`LSP read loop failed: ${getErrorMessage(error)}`));
      return;
    }

    this.failAll(new Error(`LSP stream closed (${this.candidate.label})`));
  }

  private async processBufferedMessages(): Promise<void> {
    while (true) {
      const headerBoundary = findHeaderBoundary(this.readBuffer);
      if (headerBoundary < 0) return;

      const headerBytes = this.readBuffer.slice(0, headerBoundary);
      const headerText = textDecoder.decode(headerBytes);
      const contentLength = parseContentLength(headerText);
      if (contentLength === null) {
        throw new RuntimeError(
          `Missing Content-Length header from ${this.candidate.label}`,
        );
      }

      const messageStart = headerBoundary + HEADER_DELIMITER.length;
      if (this.readBuffer.length < messageStart + contentLength) return;

      const bodyBytes = this.readBuffer.slice(messageStart, messageStart + contentLength);
      this.readBuffer = this.readBuffer.slice(messageStart + contentLength);

      const payload = JSON.parse(textDecoder.decode(bodyBytes));
      await this.handleIncomingMessage(payload);
    }
  }

  private async handleIncomingMessage(message: unknown): Promise<void> {
    if (!isObjectValue(message)) return;

    if (typeof message.id === "number" && ("result" in message || "error" in message)) {
      const pending = this.pendingRequests.get(message.id);
      if (!pending) return;
      this.pendingRequests.delete(message.id);
      if ("error" in message && message.error !== undefined) {
        pending.reject(new Error(JSON.stringify(message.error)));
      } else {
        pending.resolve(message.result);
      }
      return;
    }

    if (typeof message.method !== "string") return;
    if (message.method === "textDocument/publishDiagnostics") {
      const params = isPublishDiagnosticsMessage(message.params) ? message.params : null;
      if (!params) return;
      this.diagnosticsSequence += 1;
      const waiters = this.diagnosticWaiters.get(params.uri) ?? [];
      for (const waiter of waiters) {
        const matchesVersion = params.version === undefined || params.version >= waiter.version;
        const matchesSequence = this.diagnosticsSequence >= waiter.minSequence;
        if (matchesVersion && matchesSequence) {
          waiter.consume(params);
        }
      }
      return;
    }

    if (typeof message.id === "number") {
      await this.handleServerRequest(message.id, message.method, message.params);
    }
  }

  private async handleServerRequest(
    id: number,
    method: string,
    params: unknown,
  ): Promise<void> {
    switch (method) {
      case "workspace/configuration": {
        const items = isObjectValue(params) && Array.isArray(params.items)
          ? params.items
          : [];
        const result = items.map((item) =>
          resolveSettingsValue(
            this.candidate.settings,
            isObjectValue(item) && typeof item.section === "string"
              ? item.section
              : undefined,
          )
        );
        await this.sendResponse(id, result);
        return;
      }
      case "workspace/workspaceFolders":
        await this.sendResponse(id, [{
          uri: this.workspaceUri,
          name: getPlatform().path.basename(this.workspace),
        }]);
        return;
      case "window/workDoneProgress/create":
      case "client/registerCapability":
      case "client/unregisterCapability":
        await this.sendResponse(id, {});
        return;
      default:
        await this.sendError(id, -32601, `Unsupported client request: ${method}`);
    }
  }

  private async sendRequest(
    method: string,
    params: unknown,
  ): Promise<unknown> {
    this.throwIfClosed();
    const id = this.nextRequestId++;
    const result = new Promise<unknown>((resolve, reject) => {
      this.pendingRequests.set(id, { resolve, reject });
    });
    try {
      await this.sendFrame({ jsonrpc: "2.0", id, method, params });
    } catch (error) {
      this.pendingRequests.delete(id);
      throw error;
    }
    return await result;
  }

  private async sendNotification(
    method: string,
    params: unknown,
  ): Promise<void> {
    this.throwIfClosed();
    await this.sendFrame({ jsonrpc: "2.0", method, params });
  }

  private async sendResponse(id: number, result: unknown): Promise<void> {
    if (this.isClosed) return;
    await this.sendFrame({ jsonrpc: "2.0", id, result });
  }

  private async sendError(
    id: number,
    code: number,
    message: string,
  ): Promise<void> {
    if (this.isClosed) return;
    await this.sendFrame({
      jsonrpc: "2.0",
      id,
      error: { code, message },
    });
  }

  private async sendFrame(payload: unknown): Promise<void> {
    const body = textEncoder.encode(JSON.stringify(payload));
    const header = textEncoder.encode(
      `Content-Length: ${body.length}\r\nContent-Type: application/vscode-jsonrpc; charset=utf-8\r\n\r\n`,
    );
    await writeToProcessStdin(this.process.stdin, appendBytes(header, body));
  }

  private waitForDiagnostics(
    uri: string,
    version: number,
    signal?: AbortSignal,
  ): Promise<PublishDiagnosticsMessage> {
    return withTimeout(
      async (combinedSignal) =>
        await new Promise<PublishDiagnosticsMessage>((resolve, reject) => {
          if (combinedSignal.aborted) {
            reject(combinedSignal.reason ?? new Error("Operation aborted"));
            return;
          }
          let finished = false;
          let latest: PublishDiagnosticsMessage | null = null;
          let settleTimer: ReturnType<typeof setTimeout> | null = null;

          const settleDelay = (value: PublishDiagnosticsMessage): number =>
            value.diagnostics.length === 0
              ? EMPTY_DIAGNOSTICS_SETTLE_MS
              : DIAGNOSTICS_SETTLE_MS;

          const waiter: PendingDiagnosticsWaiter = {
            version,
            minSequence: this.diagnosticsSequence + 1,
            consume: (value) => {
              if (finished) return;
              latest = value;
              if (settleTimer !== null) {
                clearTimeout(settleTimer);
              }
              settleTimer = setTimeout(() => {
                if (finished || latest === null) return;
                finished = true;
                waiter.cleanup();
                resolve(latest);
              }, settleDelay(value));
            },
            reject: (error) => {
              if (finished) return;
              finished = true;
              waiter.cleanup();
              reject(error);
            },
            cleanup: () => {
              if (settleTimer !== null) {
                clearTimeout(settleTimer);
                settleTimer = null;
              }
              const waiters = this.diagnosticWaiters.get(uri);
              if (!waiters) return;
              const filtered = waiters.filter((entry) => entry !== waiter);
              if (filtered.length > 0) {
                this.diagnosticWaiters.set(uri, filtered);
              } else {
                this.diagnosticWaiters.delete(uri);
              }
            },
          };
          const onAbort = () => {
            waiter.cleanup();
            reject(combinedSignal.reason ?? new Error("Operation aborted"));
          };
          combinedSignal.addEventListener("abort", onAbort, { once: true });
          const waiters = this.diagnosticWaiters.get(uri) ?? [];
          waiters.push(waiter);
          this.diagnosticWaiters.set(uri, waiters);
          const originalCleanup = waiter.cleanup;
          waiter.cleanup = () => {
            combinedSignal.removeEventListener("abort", onAbort);
            originalCleanup();
          };
        }),
      {
        timeoutMs: this.candidate.diagnosticsTimeoutMs ?? DIAGNOSTICS_TIMEOUT_MS,
        signal,
        label: "LSP diagnostics wait",
      },
    );
  }

  private throwIfClosed(): void {
    if (this.processClosedError) throw this.processClosedError;
  }

  private failAll(error: Error): void {
    if (this.processClosedError) return;
    this.processClosedError = error;
    for (const pending of this.pendingRequests.values()) {
      pending.reject(error);
    }
    this.pendingRequests.clear();
    for (const waiters of this.diagnosticWaiters.values()) {
      for (const waiter of waiters) {
        waiter.cleanup();
        waiter.reject(error);
      }
    }
    this.diagnosticWaiters.clear();
  }
}

export function createLspDiagnosticsRuntime(
  options: LspDiagnosticsRuntimeOptions,
): LspDiagnosticsRuntime {
  const logger = getAgentLogger();
  const sessions = new Map<string, LspSession>();
  const pendingStarts = new Map<string, Promise<LspSession | null>>();
  const unavailableCandidates = new Set<string>();
  const resolveCandidates = options.resolveCandidates ?? resolveDefaultLspCandidates;

  const getOrStartSession = async (
    candidate: LspServerCandidate,
  ): Promise<LspSession | null> => {
    const existing = sessions.get(candidate.key);
    if (existing && !existing.isClosed) {
      return existing;
    }
    if (existing?.isClosed) {
      sessions.delete(candidate.key);
    }
    if (unavailableCandidates.has(candidate.key)) return null;

    const pending = pendingStarts.get(candidate.key);
    if (pending) return await pending;

    const startPromise = LspSession.create(candidate, options.workspace)
      .then((session) => {
        sessions.set(candidate.key, session);
        return session;
      })
      .catch((error) => {
        unavailableCandidates.add(candidate.key);
        logger.debug(`LSP unavailable (${candidate.label}): ${getErrorMessage(error)}`);
        return null;
      })
      .finally(() => {
        pendingStarts.delete(candidate.key);
      });
    pendingStarts.set(candidate.key, startPromise);
    return await startPromise;
  };

  return {
    verifyFile: async (
      filePath: string,
      signal?: AbortSignal,
    ): Promise<WriteVerificationResult | null> => {
      const absolutePath = toAbsolutePath(filePath, options.workspace);
      const candidates = await resolveCandidates(absolutePath, options.workspace);
      if (candidates.length === 0) return null;

      for (const candidate of candidates) {
        const session = await getOrStartSession(candidate);
        if (!session) continue;
        try {
          return await session.verifyDocument(absolutePath, signal);
        } catch (error) {
          if (error instanceof TimeoutError) {
            logger.debug(
              `LSP diagnostics timed out (${candidate.label}): ${getErrorMessage(error)}`,
            );
            continue;
          }
          logger.debug(
            `LSP diagnostics failed (${candidate.label}): ${getErrorMessage(error)}`,
          );
          sessions.delete(candidate.key);
          await session.dispose().catch(() => {});
        }
      }

      return null;
    },
    dispose: async (): Promise<void> => {
      const active = [...sessions.values()];
      sessions.clear();
      pendingStarts.clear();
      unavailableCandidates.clear();
      await Promise.allSettled(active.map((session) => session.dispose()));
    },
  };
}
