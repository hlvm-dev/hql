import { http } from "../../common/http-client.ts";
import { closeProcessStdin, writeToProcessStdin } from "../../common/process-io.ts";
import { safeStringify } from "../../common/safe-stringify.ts";
import { createProcessAbortHandler, readProcessStream } from "../../common/stream-utils.ts";
import { TimeoutError, withTimeout } from "../../common/timeout-utils.ts";
import { getErrorMessage, isObjectValue, truncate } from "../../common/utils.ts";
import { getPlatform } from "../../platform/platform.ts";
import { getAgentLogger } from "./logger.ts";

const HOOKS_CONFIG_PATH = ".hlvm/hooks.json";
const DEFAULT_HOOK_TIMEOUT_MS = 1000;
const MAX_HOOK_OUTPUT_PREVIEW = 300;

const HOOK_NAME_LIST = [
  "pre_llm",
  "post_llm",
  "pre_tool",
  "post_tool",
  "plan_created",
  "write_verified",
  "final_response",
  "session_start",
  "session_end",
  "pre_compact",
  "user_prompt_submit",
] as const;

export type AgentHookName = typeof HOOK_NAME_LIST[number];

const HOOK_NAMES: ReadonlySet<string> = new Set(HOOK_NAME_LIST);

export interface CommandHookHandler {
  type?: "command"; // optional — backward compat with existing hooks.json
  command: string[];
  timeoutMs?: number;
  cwd?: string;
  env?: Record<string, string>;
}

export interface PromptHookHandler {
  type: "prompt";
  prompt: string; // template — ${PAYLOAD} replaced with JSON payload
  timeoutMs?: number;
}

export interface HttpHookHandler {
  type: "http";
  url: string;
  headers?: Record<string, string>;
  timeoutMs?: number;
}

export type AgentHookHandler =
  | CommandHookHandler
  | PromptHookHandler
  | HttpHookHandler;

/** Result from a hook that supports feedback (exit code 2). */
export interface HookFeedback {
  /** Whether the hook blocked the action (exit code 2). */
  blocked: boolean;
  /** Feedback message from the hook (stdout on exit code 2). */
  feedback?: string;
}

export interface AgentHookRuntime {
  hasHandlers(name: AgentHookName): boolean;
  dispatch(name: AgentHookName, payload: unknown): Promise<void>;
  /** Dispatch and return feedback if any handler exits with code 2. */
  dispatchWithFeedback(name: AgentHookName, payload: unknown): Promise<HookFeedback>;
  dispatchDetached(name: AgentHookName, payload: unknown): void;
  waitForIdle(): Promise<void>;
}

export function getHooksConfigPath(workspace: string): string {
  return getPlatform().path.join(workspace, HOOKS_CONFIG_PATH);
}

function isHookName(value: string): value is AgentHookName {
  return HOOK_NAMES.has(value);
}

function normalizeTimeoutMs(input: unknown): number | undefined {
  if (!isObjectValue(input)) return undefined;
  return typeof input.timeoutMs === "number" &&
      Number.isFinite(input.timeoutMs) &&
      input.timeoutMs > 0
    ? Math.floor(input.timeoutMs)
    : undefined;
}

function normalizeHookHandler(input: unknown): AgentHookHandler | null {
  if (!isObjectValue(input)) return null;

  // Prompt hook
  if (
    input.type === "prompt" &&
    typeof input.prompt === "string" &&
    input.prompt.trim().length > 0
  ) {
    const handler: PromptHookHandler = {
      type: "prompt",
      prompt: input.prompt,
    };
    const timeoutMs = normalizeTimeoutMs(input);
    if (timeoutMs !== undefined) handler.timeoutMs = timeoutMs;
    return handler;
  }

  // HTTP hook
  if (
    input.type === "http" &&
    typeof input.url === "string" &&
    input.url.trim().length > 0
  ) {
    const handler: HttpHookHandler = { type: "http", url: input.url.trim() };
    const timeoutMs = normalizeTimeoutMs(input);
    if (timeoutMs !== undefined) handler.timeoutMs = timeoutMs;
    if (isObjectValue(input.headers)) {
      const headers = Object.fromEntries(
        Object.entries(input.headers).filter(
          (entry): entry is [string, string] => typeof entry[1] === "string",
        ),
      );
      if (Object.keys(headers).length > 0) handler.headers = headers;
    }
    return handler;
  }

  // Command hook (default — type is optional for backward compat)
  const command = Array.isArray(input.command)
    ? input.command.filter((value): value is string =>
      typeof value === "string" && value.trim().length > 0
    )
    : [];
  if (command.length === 0) return null;

  const timeoutMs = normalizeTimeoutMs(input);
  const cwd = typeof input.cwd === "string" && input.cwd.trim().length > 0
    ? input.cwd.trim()
    : undefined;
  const env = isObjectValue(input.env)
    ? Object.fromEntries(
      Object.entries(input.env).filter((entry): entry is [string, string] =>
        typeof entry[1] === "string"
      ),
    )
    : undefined;

  return {
    command,
    timeoutMs,
    cwd,
    ...(env && Object.keys(env).length > 0 ? { env } : {}),
  };
}

function normalizeHooksConfig(
  input: unknown,
): Map<AgentHookName, AgentHookHandler[]> | null {
  if (!isObjectValue(input) || input.version !== 1) return null;
  const hooksValue = isObjectValue(input.hooks) ? input.hooks : {};
  const hooks = new Map<AgentHookName, AgentHookHandler[]>();
  for (const [key, value] of Object.entries(hooksValue)) {
    if (!isHookName(key) || !Array.isArray(value)) continue;
    const handlers = value.map(normalizeHookHandler).filter((
      handler,
    ): handler is AgentHookHandler => handler !== null);
    if (handlers.length > 0) {
      hooks.set(key, handlers);
    }
  }
  return hooks;
}

class Runtime implements AgentHookRuntime {
  #queue: Promise<void> = Promise.resolve();

  constructor(
    private readonly workspace: string,
    private readonly hooks: Map<AgentHookName, AgentHookHandler[]>,
  ) {}

  hasHandlers(name: AgentHookName): boolean {
    return (this.hooks.get(name)?.length ?? 0) > 0;
  }

  dispatch(name: AgentHookName, payload: unknown): Promise<void> {
    const handlers = this.hooks.get(name);
    if (!handlers?.length) return Promise.resolve();
    this.#queue = this.#queue.then(() => this.runHandlers(name, handlers, payload));
    return this.#queue;
  }

  async dispatchWithFeedback(
    name: AgentHookName,
    payload: unknown,
  ): Promise<HookFeedback> {
    const handlers = this.hooks.get(name);
    if (!handlers?.length) return { blocked: false };
    const envelope = this.buildEnvelope(name, payload);
    for (const handler of handlers) {
      const result = await this.routeHandlerWithResult(name, handler, envelope);
      if (result.exitCode === 2) {
        return { blocked: true, feedback: result.stdout };
      }
    }
    return { blocked: false };
  }

  dispatchDetached(name: AgentHookName, payload: unknown): void {
    void this.dispatch(name, payload);
  }

  async waitForIdle(): Promise<void> {
    await this.#queue;
  }

  private buildEnvelope(name: AgentHookName, payload: unknown) {
    return {
      version: 1,
      hook: name,
      workspace: this.workspace,
      timestamp: new Date().toISOString(),
      payload,
    };
  }

  private async runHandlers(
    name: AgentHookName,
    handlers: AgentHookHandler[],
    payload: unknown,
  ): Promise<void> {
    const envelope = this.buildEnvelope(name, payload);
    for (const handler of handlers) {
      await this.routeHandlerWithResult(name, handler, envelope);
    }
  }

  /** Parse a decision response from prompt/http hooks. */
  private parseDecisionResponse(
    body: string,
  ): { exitCode: number; stdout: string } {
    try {
      const parsed = JSON.parse(body);
      if (isObjectValue(parsed) && parsed.decision === "block") {
        return {
          exitCode: 2,
          stdout: typeof parsed.reason === "string" ? parsed.reason : "",
        };
      }
    } catch { /* non-JSON or malformed — treat as allow */ }
    return { exitCode: 0, stdout: "" };
  }

  /** Execute a prompt hook via local LLM. */
  private async runPromptHookWithResult(
    name: AgentHookName,
    handler: PromptHookHandler,
    payload: unknown,
  ): Promise<{ exitCode: number; stdout: string }> {
    try {
      const payloadJson = safeStringify(payload, 0);
      const prompt = handler.prompt.replaceAll("${PAYLOAD}", payloadJson);
      const { collectChat } = await import(
        "../runtime/local-llm.ts"
      ) as { collectChat: (p: string, o: { temperature?: number; maxTokens?: number }) => Promise<string> };
      const response: string = await withTimeout(
        (_signal: AbortSignal) =>
          collectChat(prompt, {
            temperature: 0,
            maxTokens: 256,
          }),
        {
          timeoutMs: handler.timeoutMs ?? DEFAULT_HOOK_TIMEOUT_MS,
          label: `agent prompt hook ${name}`,
        },
      );
      return this.parseDecisionResponse(response);
    } catch (error) {
      this.logFailure(name, "prompt", getErrorMessage(error));
      return { exitCode: 0, stdout: "" }; // fail-open
    }
  }

  /** Execute an HTTP hook via SSOT http client. */
  private async runHttpHookWithResult(
    name: AgentHookName,
    handler: HttpHookHandler,
    payload: unknown,
  ): Promise<{ exitCode: number; stdout: string }> {
    try {
      const body = safeStringify(payload, 0);
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
        ...(handler.headers ?? {}),
      };
      const response = await withTimeout(
        (_signal: AbortSignal) =>
          http.fetchRaw(handler.url, { method: "POST", headers, body }),
        {
          timeoutMs: handler.timeoutMs ?? DEFAULT_HOOK_TIMEOUT_MS,
          label: `agent http hook ${name}`,
        },
      );
      const text = await response.text();
      return this.parseDecisionResponse(text);
    } catch (error) {
      this.logFailure(name, handler.url, getErrorMessage(error));
      return { exitCode: 0, stdout: "" }; // fail-open
    }
  }

  /** Route a handler to the correct execution path and return result. */
  private async routeHandlerWithResult(
    name: AgentHookName,
    handler: AgentHookHandler,
    envelope: unknown,
  ): Promise<{ exitCode: number; stdout: string }> {
    const payload = (envelope as { payload: unknown }).payload;
    if ("type" in handler && handler.type === "prompt") {
      return this.runPromptHookWithResult(name, handler, payload);
    }
    if ("type" in handler && handler.type === "http") {
      return this.runHttpHookWithResult(name, handler, payload);
    }
    return this.runSingleCommandHandlerWithResult(
      name,
      handler as CommandHookHandler,
      envelope,
    );
  }

  /** DRY helper: resolve cwd, spawn process, write payload, and collect output. */
  private spawnHookProcess(
    name: AgentHookName,
    handler: CommandHookHandler,
    envelope: unknown,
  ): { process: ReturnType<ReturnType<typeof getPlatform>["command"]["run"]>; payloadBytes: Uint8Array } | null {
    const platform = getPlatform();
    const cwd = handler.cwd
      ? platform.path.isAbsolute(handler.cwd)
        ? handler.cwd
        : platform.path.join(this.workspace, handler.cwd)
      : this.workspace;

    try {
      return {
        process: platform.command.run({
          cmd: handler.command,
          cwd,
          env: {
            ...platform.env.toObject(),
            ...(handler.env ?? {}),
            HLVM_AGENT_HOOK: name,
            HLVM_AGENT_WORKSPACE: this.workspace,
          },
          stdin: "piped",
          stdout: "piped",
          stderr: "piped",
        }),
        payloadBytes: new TextEncoder().encode(`${safeStringify(envelope, 0)}\n`),
      };
    } catch (error) {
      this.logFailure(
        name,
        handler.command.join(" "),
        `spawn failed: ${getErrorMessage(error)}`,
      );
      return null;
    }
  }

  private async runSingleCommandHandler(
    name: AgentHookName,
    handler: CommandHookHandler,
    envelope: unknown,
  ): Promise<void> {
    const spawned = this.spawnHookProcess(name, handler, envelope);
    if (!spawned) return;
    const { process, payloadBytes } = spawned;

    const abortHandler = createProcessAbortHandler(process, getPlatform().build.os);
    try {
      await withTimeout(async (signal) => {
        const onAbort = (): void => abortHandler.abort();
        signal.addEventListener("abort", onAbort, { once: true });
        try {
          await writeToProcessStdin(process.stdin, payloadBytes);
          await closeProcessStdin(process.stdin);
          const [stdoutBytes, stderrBytes, status] = await Promise.all([
            readProcessStream(process.stdout, signal),
            readProcessStream(process.stderr, signal),
            process.status,
          ]);
          if (!status.success) {
            const stderrText = new TextDecoder().decode(
              stderrBytes.length > 0 ? stderrBytes : stdoutBytes,
            ).trim();
            this.logFailure(
              name,
              handler.command.join(" "),
              `exit ${status.code}${
                stderrText
                  ? `: ${truncate(stderrText, MAX_HOOK_OUTPUT_PREVIEW)}`
                  : ""
              }`,
            );
          }
        } finally {
          signal.removeEventListener("abort", onAbort);
        }
      }, {
        timeoutMs: handler.timeoutMs ?? DEFAULT_HOOK_TIMEOUT_MS,
        label: `agent hook ${name}`,
      });
    } catch (error) {
      if (error instanceof TimeoutError) {
        this.logFailure(
          name,
          handler.command.join(" "),
          `timed out after ${handler.timeoutMs ?? DEFAULT_HOOK_TIMEOUT_MS}ms`,
        );
      } else {
        this.logFailure(
          name,
          handler.command.join(" "),
          getErrorMessage(error),
        );
      }
    } finally {
      abortHandler.clear();
    }
  }

  private async runSingleCommandHandlerWithResult(
    name: AgentHookName,
    handler: CommandHookHandler,
    envelope: unknown,
  ): Promise<{ exitCode: number; stdout: string }> {
    const spawned = this.spawnHookProcess(name, handler, envelope);
    if (!spawned) return { exitCode: 1, stdout: "" };
    const { process, payloadBytes } = spawned;

    try {
      await writeToProcessStdin(process.stdin, payloadBytes);
      await closeProcessStdin(process.stdin);

      const [stdoutBytes, , status] = await Promise.all([
        readProcessStream(process.stdout),
        readProcessStream(process.stderr),
        process.status,
      ]);

      return {
        exitCode: status.code,
        stdout: new TextDecoder().decode(stdoutBytes).trim(),
      };
    } catch {
      return { exitCode: 1, stdout: "" };
    }
  }

  private logFailure(
    name: AgentHookName,
    source: string,
    detail: string,
  ): void {
    getAgentLogger().warn(`Agent hook ${name} failed (${source}): ${detail}`);
  }
}

/**
 * Load hook runtime from unified settings.json (config.hooks) + workspace fallback.
 *
 * Merge order: global hooks from settings.json, then workspace .hlvm/hooks.json
 * overrides per event name.
 */
export async function loadAgentHookRuntime(
  workspace: string,
  globalHooks?: Record<string, unknown[]>,
): Promise<AgentHookRuntime | null> {
  const merged = new Map<AgentHookName, AgentHookHandler[]>();

  // 1. Global hooks from settings.json (passed by caller or loaded from config)
  let effectiveGlobal = globalHooks;
  if (!effectiveGlobal) {
    try {
      const { loadConfig } = await import("../../common/config/storage.ts");
      const config = await loadConfig();
      effectiveGlobal = config.hooks as Record<string, unknown[]> | undefined;
    } catch { /* config unavailable */ }
  }
  if (effectiveGlobal) {
    const normalized = normalizeHooksConfig({ version: 1, hooks: effectiveGlobal });
    if (normalized) {
      for (const [name, handlers] of normalized) {
        merged.set(name, handlers);
      }
    }
  }

  // 2. Workspace hooks (override global per event name)
  const platform = getPlatform();
  const path = getHooksConfigPath(workspace);
  if (await platform.fs.exists(path)) {
    try {
      const content = await platform.fs.readTextFile(path);
      const parsed = JSON.parse(content);
      const wsHooks = normalizeHooksConfig(parsed);
      if (wsHooks) {
        for (const [name, handlers] of wsHooks) {
          merged.set(name, handlers); // workspace overrides global
        }
      }
    } catch (error) {
      getAgentLogger().warn(
        `Agent hooks load failed (${path}): ${getErrorMessage(error)}`,
      );
    }
  }

  if (merged.size === 0) return null;
  return new Runtime(workspace, merged);
}
