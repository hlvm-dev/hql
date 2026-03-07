import { getPlatform } from "../../../src/platform/platform.ts";
import type {
  PlatformHttpServeOptions,
  PlatformHttpServerHandle,
} from "../../../src/platform/types.ts";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isPermissionOrAddrInUseError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const name = (error as { name?: string }).name ?? "";
  const code = (error as { code?: string }).code ?? "";
  return (
    name === "PermissionDenied" ||
    name === "AddrInUse" ||
    code === "EACCES" ||
    code === "EADDRINUSE"
  );
}

export function isPermissionDeniedError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const name = (error as { name?: string }).name ?? "";
  const code = (error as { code?: string }).code ?? "";
  return name === "PermissionDenied" || code === "EACCES";
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
  const dir = await platform.fs.makeTempDir({ prefix });
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
  options: PlatformHttpServeOptions,
  handler: (req: Request) => Response | Promise<Response>,
  maxAttempts = 5,
): Promise<PlatformHttpServerHandle> {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return getPlatform().http.serveWithHandle!(handler, options);
    } catch (error) {
      if (!isPermissionOrAddrInUseError(error) || attempt === maxAttempts) {
        throw error;
      }
      await sleep(40 * attempt);
    }
  }
  throw new Error("Failed to start server after retries");
}
