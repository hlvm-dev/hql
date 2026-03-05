import { getPlatform } from "../../../src/platform/platform.ts";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function isPermissionDeniedError(error: unknown): boolean {
  return error instanceof Deno.errors.PermissionDenied;
}

export async function withServePermissionGuard(
  fn: () => Promise<void>,
): Promise<void> {
  try {
    await fn();
  } catch (error) {
    if (isPermissionDeniedError(error)) {
      return;
    }
    throw error;
  }
}

export async function withOAuthStorePath<T>(
  prefix: string,
  fn: (storePath: string) => Promise<T>,
): Promise<T> {
  const platform = getPlatform();
  const dir = await Deno.makeTempDir({ prefix });
  const path = platform.path.join(dir, "mcp-oauth.json");
  await platform.fs.writeTextFile(
    path,
    JSON.stringify({ version: 1, records: [] }, null, 2) + "\n",
  );
  try {
    return await fn(path);
  } finally {
    await platform.fs.remove(dir, { recursive: true });
  }
}

export async function serveWithRetry(
  options: Deno.ServeTcpOptions,
  handler: (req: Request) => Response | Promise<Response>,
  maxAttempts = 5,
): Promise<Deno.HttpServer> {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return Deno.serve(options, handler);
    } catch (error) {
      if (!(error instanceof Deno.errors.PermissionDenied) || attempt === maxAttempts) {
        throw error;
      }
      await sleep(40 * attempt);
    }
  }
  throw new Error("Failed to start Deno.serve after retries");
}
