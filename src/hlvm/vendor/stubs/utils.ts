// Stubs for CC's utils/* that the Ink fork imports

import { getPlatform } from "../../../platform/platform.ts";

export function stopCapturingEarlyInput(): void {}

export function isEnvTruthy(val: string | undefined): boolean {
  return val === "1" || val === "true" || val === "yes";
}

export function isMouseClicksDisabled(): boolean {
  return isEnvTruthy(getPlatform().env.get("CLAUDE_CODE_DISABLE_MOUSE_CLICKS"));
}

export function getGraphemeSegmenter(): Intl.Segmenter {
  return new Intl.Segmenter(undefined, { granularity: "grapheme" });
}

export const env = new Proxy({} as Record<string, string | undefined>, {
  get(_target, prop: string) {
    try {
      return getPlatform().env.get(prop);
    } catch {
      return undefined;
    }
  },
});

export function gte(a: string, b: string): boolean {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const va = pa[i] ?? 0;
    const vb = pb[i] ?? 0;
    if (va > vb) return true;
    if (va < vb) return false;
  }
  return true;
}

interface ExecFileOptions {
  readonly input?: string;
  readonly timeout?: number;
  readonly useCwd?: boolean;
  readonly env?: Record<string, string>;
}

interface ExecFileResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly code: number;
  readonly error?: string;
}

// Async port of CC's `execFileNoThrow` backed by the platform SSOT
// (getPlatform().command.run). The previous stub returned
// `{ exitCode: 1 }` synchronously — it never actually spawned the
// requested command. That made the ink engine's clipboard path
// (`copyNative` → `pbcopy`) a no-op, so drag-select wrote nothing to
// the system pasteboard and Terminal.app beeped on Cmd+C.
export function execFileNoThrow(
  cmd: string,
  args: string[] = [],
  options: ExecFileOptions = {},
): Promise<ExecFileResult> {
  const platform = getPlatform();
  let proc;
  try {
    proc = platform.command.run({
      cmd: [cmd, ...args],
      env: options.env,
      stdin: options.input !== undefined ? "piped" : "null",
      stdout: "piped",
      stderr: "piped",
      timeout: options.timeout,
    });
  } catch (err) {
    return Promise.resolve({
      stdout: "",
      stderr: "",
      code: 1,
      error: err instanceof Error ? err.message : String(err),
    });
  }

  // Feed input to stdin when provided. `getPlatform().command.run` exposes
  // a Web `WritableStream<Uint8Array>` under Deno and a Node Writable
  // stream under Node; branch on shape so pbcopy / `tmux load-buffer`
  // observe their payload + EOF on either runtime.
  if (options.input !== undefined && proc.stdin) {
    const payload = new TextEncoder().encode(options.input);
    void (async () => {
      try {
        const stdin = proc.stdin as unknown;
        if (stdin && typeof (stdin as { getWriter?: unknown }).getWriter === "function") {
          const writer = (stdin as WritableStream<Uint8Array>).getWriter();
          await writer.write(payload);
          await writer.close();
        } else if (stdin && typeof (stdin as { write?: unknown }).write === "function") {
          const nodeStdin = stdin as {
            write: (data: Uint8Array | string) => unknown;
            end: () => unknown;
          };
          nodeStdin.write(payload);
          nodeStdin.end();
        }
      } catch {
        /* pipe may tear down on timeout — surfaces as non-zero exit */
      }
    })();
  }

  const decoder = new TextDecoder();
  const collect = async (
    stream: unknown,
  ): Promise<string> => {
    if (!stream || typeof stream !== "object") return "";
    const reader = (stream as ReadableStream<Uint8Array>).getReader?.();
    if (!reader) return "";
    const chunks: Uint8Array[] = [];
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      if (value) chunks.push(value);
    }
    const total = chunks.reduce((n, c) => n + c.byteLength, 0);
    const merged = new Uint8Array(total);
    let offset = 0;
    for (const c of chunks) {
      merged.set(c, offset);
      offset += c.byteLength;
    }
    return decoder.decode(merged);
  };

  return (async () => {
    try {
      const [status, stdout, stderr] = await Promise.all([
        proc.status,
        collect(proc.stdout),
        collect(proc.stderr),
      ]);
      return {
        stdout,
        stderr,
        code: status.code,
        error: status.success ? undefined : stderr || String(status.code),
      };
    } catch (err) {
      return {
        stdout: "",
        stderr: "",
        code: 1,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  })();
}
