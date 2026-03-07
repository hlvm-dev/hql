import { getPlatform } from "../../src/platform/platform.ts";

export function withEnv(
  key: string,
  value: string,
  fn: () => Promise<void>,
): Promise<void> {
  const env = getPlatform().env;
  const prev = env.get(key);
  env.set(key, value);
  return fn().finally(() => {
    if (prev === undefined) {
      env.delete(key);
    } else {
      env.set(key, prev);
    }
  });
}

export async function findFreePort(): Promise<number> {
  const listener = Deno.listen({ hostname: "127.0.0.1", port: 0 });
  try {
    const addr = listener.addr as Deno.NetAddr;
    return addr.port;
  } finally {
    listener.close();
  }
}
