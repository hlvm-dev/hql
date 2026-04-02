import { getPlatform } from "../platform/platform.ts";

export async function tryAcquireDirLock(
  lockPath: string,
  staleMs: number,
): Promise<boolean> {
  const platform = getPlatform();
  try {
    await platform.fs.mkdir(lockPath);
    return true;
  } catch {
    try {
      const info = await platform.fs.stat(lockPath);
      const modifiedAt = typeof info.mtimeMs === "number"
        ? info.mtimeMs
        : undefined;
      if (
        modifiedAt !== undefined &&
        Date.now() - modifiedAt > staleMs
      ) {
        await platform.fs.remove(lockPath, { recursive: true });
        await platform.fs.mkdir(lockPath);
        return true;
      }
    } catch {
      // Another process may have released or recreated the lock meanwhile.
    }
    return false;
  }
}

export async function releaseDirLock(lockPath: string): Promise<void> {
  try {
    await getPlatform().fs.remove(lockPath, { recursive: true });
  } catch {
    // Best-effort cleanup only.
  }
}
