import { getPlatform } from "../platform/platform.ts";
import type { PlatformFileInfo } from "../platform/types.ts";
import { ValidationError } from "./error.ts";
import { generateUUID, isFileNotFoundError } from "./utils.ts";

function buildTempPath(filePath: string): string {
  const platform = getPlatform();
  const dir = platform.path.dirname(filePath);
  const base = platform.path.basename(filePath);
  return platform.path.join(
    dir,
    `.${base}.tmp.${platform.process.pid()}.${Date.now()}.${generateUUID()}`,
  );
}

function assertNoSymlinkTarget(
  filePath: string,
  info: { isSymlink: boolean } | null,
): void {
  if (!info?.isSymlink) return;
  throw new ValidationError(
    `Atomic writes refuse symlink targets: ${filePath}`,
    "atomic_file",
  );
}

async function readExistingInfo(
  filePath: string,
): Promise<PlatformFileInfo | null> {
  try {
    const info = await getPlatform().fs.lstat(filePath);
    assertNoSymlinkTarget(filePath, info);
    return info;
  } catch (error) {
    if (isFileNotFoundError(error)) return null;
    throw error;
  }
}

function readExistingInfoSync(
  filePath: string,
): PlatformFileInfo | null {
  try {
    const info = getPlatform().fs.lstatSync(filePath);
    assertNoSymlinkTarget(filePath, info);
    return info;
  } catch (error) {
    if (isFileNotFoundError(error)) return null;
    throw error;
  }
}

async function cleanupTempFile(tempPath: string): Promise<void> {
  try {
    await getPlatform().fs.remove(tempPath);
  } catch {
    // Best-effort cleanup.
  }
}

function cleanupTempFileSync(tempPath: string): void {
  try {
    getPlatform().fs.removeSync(tempPath);
  } catch {
    // Best-effort cleanup.
  }
}

export async function atomicWriteTextFile(
  filePath: string,
  content: string,
): Promise<void> {
  const platform = getPlatform();
  const existingInfo = await readExistingInfo(filePath);
  const tempPath = buildTempPath(filePath);

  try {
    await platform.fs.ensureDir(platform.path.dirname(filePath));
    await platform.fs.writeTextFile(
      tempPath,
      content,
      existingInfo?.mode ? { mode: existingInfo.mode } : undefined,
    );
    if (existingInfo?.mode !== undefined) {
      await platform.fs.chmod(tempPath, existingInfo.mode);
    }
    await platform.fs.rename(tempPath, filePath);
  } catch (error) {
    await cleanupTempFile(tempPath);
    throw error;
  }
}

export function atomicWriteTextFileSync(
  filePath: string,
  content: string,
): void {
  const platform = getPlatform();
  const existingInfo = readExistingInfoSync(filePath);
  const tempPath = buildTempPath(filePath);

  try {
    platform.fs.mkdirSync(platform.path.dirname(filePath), { recursive: true });
    platform.fs.writeTextFileSync(
      tempPath,
      content,
      existingInfo?.mode ? { mode: existingInfo.mode } : undefined,
    );
    if (existingInfo?.mode !== undefined) {
      platform.fs.chmodSync(tempPath, existingInfo.mode);
    }
    platform.fs.renameSync(tempPath, filePath);
  } catch (error) {
    cleanupTempFileSync(tempPath);
    throw error;
  }
}
