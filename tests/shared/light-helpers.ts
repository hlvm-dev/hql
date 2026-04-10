import { log } from "../../src/hlvm/api/log.ts";
import { getPlatform } from "../../src/platform/platform.ts";
import { getRuntimeHostIdentity } from "../../src/hlvm/runtime/host-identity.ts";
import { withRuntimePortOverrideForTests } from "../../src/hlvm/runtime/host-config.ts";
import { createMonotonicPortAllocator } from "./runtime-host-test-helpers.ts";

/**
 * Create a serialized execution queue. Returned function ensures
 * only one task runs at a time -- subsequent callers wait for the
 * previous task to finish before starting.
 */
export function createSerializedQueue(): <T>(fn: () => Promise<T>) => Promise<T> {
  let queue: Promise<void> = Promise.resolve();
  return async <T>(fn: () => Promise<T>): Promise<T> => {
    const previous = queue;
    let release!: () => void;
    queue = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous.catch(() => undefined);
    try {
      return await fn();
    } finally {
      release();
    }
  };
}

const envLockQueues = new Map<string, <T>(fn: () => Promise<T>) => Promise<T>>();
const allocateMonotonicPort = createMonotonicPortAllocator();

function getEnvKeyQueue(key: string): <T>(fn: () => Promise<T>) => Promise<T> {
  let q = envLockQueues.get(key);
  if (!q) {
    q = createSerializedQueue();
    envLockQueues.set(key, q);
  }
  return q;
}

function withSerializedEnvKey<T>(
  key: string,
  fn: () => Promise<T>,
): Promise<T> {
  return getEnvKeyQueue(key)(fn);
}

export function withEnv<T>(
  key: string,
  value: string,
  fn: () => Promise<T>,
): Promise<T> {
  if (key === "HLVM_REPL_PORT") {
    const port = Number.parseInt(value, 10);
    if (Number.isInteger(port) && port > 0) {
      return withRuntimePortOverrideForTests(port, fn);
    }
  }

  return withSerializedEnvKey(key, async () => {
    const env = getPlatform().env;
    const prev = env.get(key);
    env.set(key, value);
    try {
      return await fn();
    } finally {
      if (prev === undefined) {
        env.delete(key);
      } else {
        env.set(key, prev);
      }
    }
  });
}

export async function withRuntimeHostServer(
  handler: (req: Request, authToken: string) => Response | Promise<Response>,
  fn: (context: { authToken: string; port: number }) => Promise<void>,
): Promise<void> {
  const port = await findFreePort();
  const authToken = "test-auth-token";
  const identity = await getRuntimeHostIdentity();
  const handle = getPlatform().http.serveWithHandle!(async (req) => {
    if (new URL(req.url).pathname === "/health") {
      return Response.json({
        status: "ok",
        initialized: true,
        definitions: 0,
        aiReady: true,
        version: identity.version,
        buildId: identity.buildId,
        authToken,
      });
    }
    return await handler(req, authToken);
  }, {
    hostname: "127.0.0.1",
    port,
    onListen: () => {},
  });

  try {
    await withEnv("HLVM_REPL_PORT", String(port), async () => {
      await fn({ authToken, port });
    });
  } finally {
    await handle.shutdown();
    await handle.finished;
  }
}

export async function findFreePort(): Promise<number> {
  return await allocateMonotonicPort();
}

/**
 * Strip ANSI escape codes, carriage returns, and trailing whitespace from CLI output.
 * Shared across binary and e2e tests to normalize subprocess output for assertions.
 */
export function normalizeCliOutput(text: string): string {
  return text
    .replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, "")
    .replace(/\r/g, "")
    .replace(/[ \t]+\n/g, "\n");
}

export async function withCapturedOutput(
  fn: (output: () => string) => Promise<void>,
): Promise<void> {
  const raw = log.raw as { log: (text: string) => void };
  const originalLog = raw.log;
  let output = "";

  raw.log = (text: string) => {
    output += text + (text.endsWith("\n") ? "" : "\n");
  };

  try {
    await fn(() => output);
  } finally {
    raw.log = originalLog;
  }
}
