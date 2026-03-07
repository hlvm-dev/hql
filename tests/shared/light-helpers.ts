import { getPlatform } from "../../src/platform/platform.ts";
import { getRuntimeHostIdentity } from "../../src/hlvm/runtime/host-identity.ts";
import { withRuntimePortOverrideForTests } from "../../src/hlvm/runtime/host-config.ts";

const envLocks = new Map<string, Promise<void>>();

async function withSerializedEnvKey<T>(
  key: string,
  fn: () => Promise<T>,
): Promise<T> {
  const previous = envLocks.get(key) ?? Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>((resolve) => {
    release = resolve;
  });
  envLocks.set(key, current);

  await previous;
  try {
    return await fn();
  } finally {
    if (envLocks.get(key) === current) {
      envLocks.delete(key);
    }
    release();
  }
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
  return await getPlatform().http.findFreePort();
}
