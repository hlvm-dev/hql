import { closeProcessStdin, writeToProcessStdin } from "../../common/process-io.ts";
import { safeStringify } from "../../common/safe-stringify.ts";
import { createProcessAbortHandler, readProcessStream } from "../../common/stream-utils.ts";
import { TimeoutError, withTimeout } from "../../common/timeout-utils.ts";
import { isObjectValue, truncate } from "../../common/utils.ts";
import { getPlatform } from "../../platform/platform.ts";
import { getAgentLogger } from "./logger.ts";

const HOOKS_CONFIG_PATH = ".hlvm/hooks.json";
const DEFAULT_HOOK_TIMEOUT_MS = 1000;
const MAX_HOOK_OUTPUT_PREVIEW = 300;

export type AgentHookName =
  | "pre_llm"
  | "post_llm"
  | "pre_tool"
  | "post_tool"
  | "plan_created"
  | "write_verified"
  | "delegate_start"
  | "delegate_end"
  | "final_response";

const HOOK_NAMES: ReadonlySet<AgentHookName> = new Set([
  "pre_llm",
  "post_llm",
  "pre_tool",
  "post_tool",
  "plan_created",
  "write_verified",
  "delegate_start",
  "delegate_end",
  "final_response",
]);

export interface AgentHookHandler {
  command: string[];
  timeoutMs?: number;
  cwd?: string;
  env?: Record<string, string>;
}

export interface AgentHookRuntime {
  hasHandlers(name: AgentHookName): boolean;
  dispatch(name: AgentHookName, payload: unknown): Promise<void>;
  dispatchDetached(name: AgentHookName, payload: unknown): void;
  waitForIdle(): Promise<void>;
}

function getHooksConfigPath(workspace: string): string {
  return getPlatform().path.join(workspace, HOOKS_CONFIG_PATH);
}

function isHookName(value: string): value is AgentHookName {
  return HOOK_NAMES.has(value as AgentHookName);
}

function normalizeHookHandler(input: unknown): AgentHookHandler | null {
  if (!isObjectValue(input)) return null;
  const command = Array.isArray(input.command)
    ? input.command.filter((value): value is string =>
      typeof value === "string" && value.trim().length > 0
    )
    : [];
  if (command.length === 0) return null;

  const timeoutMs = typeof input.timeoutMs === "number" &&
      Number.isFinite(input.timeoutMs) &&
      input.timeoutMs > 0
    ? Math.floor(input.timeoutMs)
    : undefined;
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

  dispatchDetached(name: AgentHookName, payload: unknown): void {
    void this.dispatch(name, payload);
  }

  async waitForIdle(): Promise<void> {
    await this.#queue;
  }

  private async runHandlers(
    name: AgentHookName,
    handlers: AgentHookHandler[],
    payload: unknown,
  ): Promise<void> {
    const envelope = {
      version: 1,
      hook: name,
      workspace: this.workspace,
      timestamp: new Date().toISOString(),
      payload,
    };

    for (const handler of handlers) {
      await this.runSingleHandler(name, handler, envelope);
    }
  }

  private async runSingleHandler(
    name: AgentHookName,
    handler: AgentHookHandler,
    envelope: unknown,
  ): Promise<void> {
    const platform = getPlatform();
    const cwd = handler.cwd
      ? platform.path.isAbsolute(handler.cwd)
        ? handler.cwd
        : platform.path.join(this.workspace, handler.cwd)
      : this.workspace;
    const payloadText = `${safeStringify(envelope, 0)}\n`;

    let process;
    try {
      process = platform.command.run({
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
      });
    } catch (error) {
      this.logFailure(
        name,
        handler.command,
        `spawn failed: ${error instanceof Error ? error.message : String(error)}`,
      );
      return;
    }

    const abortHandler = createProcessAbortHandler(process, platform.build.os);
    try {
      await withTimeout(async (signal) => {
        const onAbort = (): void => abortHandler.abort();
        signal.addEventListener("abort", onAbort, { once: true });
        try {
          await writeToProcessStdin(process.stdin, new TextEncoder().encode(payloadText));
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
              handler.command,
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
          handler.command,
          `timed out after ${handler.timeoutMs ?? DEFAULT_HOOK_TIMEOUT_MS}ms`,
        );
      } else {
        this.logFailure(
          name,
          handler.command,
          error instanceof Error ? error.message : String(error),
        );
      }
    } finally {
      abortHandler.clear();
    }
  }

  private logFailure(
    name: AgentHookName,
    command: string[],
    detail: string,
  ): void {
    getAgentLogger().warn(
      `Agent hook ${name} failed (${command.join(" ")}): ${detail}`,
    );
  }
}

export async function loadAgentHookRuntime(
  workspace: string,
): Promise<AgentHookRuntime | null> {
  const platform = getPlatform();
  const path = getHooksConfigPath(workspace);
  if (!await platform.fs.exists(path)) return null;

  let content = "";
  try {
    content = await platform.fs.readTextFile(path);
  } catch (error) {
    getAgentLogger().warn(
      `Agent hooks load failed (${path}): ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    return null;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch (error) {
    getAgentLogger().warn(
      `Agent hooks JSON invalid (${path}): ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    return null;
  }

  const hooks = normalizeHooksConfig(parsed);
  if (!hooks || hooks.size === 0) {
    getAgentLogger().warn(
      `Agent hooks ignored (${path}): expected version 1 config with at least one valid handler.`,
    );
    return null;
  }

  return new Runtime(workspace, hooks);
}
