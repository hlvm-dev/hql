import { appendJsonLine } from "../../../common/jsonl.ts";
import { getPlatform } from "../../../platform/platform.ts";
import { log } from "../../api/log.ts";
import { getErrorMessage } from "../../../common/utils.ts";

let sequence = 0;
let writeQueue: Promise<void> = Promise.resolve();

function redact(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redact);
  if (!value || typeof value !== "object") return value;

  const result: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (
      key === "pairCode" || /token|secret|authorization|signature/i.test(key)
    ) {
      result[key] = "[redacted]";
      continue;
    }
    result[key] = redact(entry);
  }
  return result;
}

export function getChannelTracePath(channel: string): string {
  const safeChannel = channel.replace(/[^a-z0-9_-]/gi, "-") || "unknown";
  return getPlatform().path.join("/tmp", `hlvm-${safeChannel}-e2e.jsonl`);
}

export function traceChannelDiagnostic(
  channel: string,
  scope: string,
  event: string,
  data: Record<string, unknown> = {},
): void {
  const safeData = redact(data);
  const record = {
    seq: ++sequence,
    at: new Date().toISOString(),
    pid: getPlatform().process.pid(),
    channel,
    scope,
    event,
    data: safeData,
  };

  log.ns(channel).debug(`[${scope}] ${event} ${JSON.stringify(safeData)}`);
  writeQueue = writeQueue
    .then(() => appendJsonLine(getChannelTracePath(channel), record))
    .catch((error) => {
      log.ns(channel).debug(
        `[${scope}] trace-write-failed ${
          JSON.stringify({ detail: getErrorMessage(error) })
        }`,
      );
    });
  void writeQueue;
}

export async function flushChannelDiagnostics(): Promise<void> {
  await writeQueue;
}
