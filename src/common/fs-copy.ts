import { getPlatform } from "../platform/platform.ts";

export interface CopyDirectoryRecursiveOptions {
  skip?: (sourcePath: string, name: string) => boolean;
}

export async function copyDirectoryRecursive(
  sourceDir: string,
  targetDir: string,
  options?: CopyDirectoryRecursiveOptions,
): Promise<void> {
  const platform = getPlatform();
  await platform.fs.mkdir(targetDir, { recursive: true });

  for await (const entry of platform.fs.readDir(sourceDir)) {
    const sourcePath = platform.path.join(sourceDir, entry.name);
    if (options?.skip?.(sourcePath, entry.name)) {
      continue;
    }

    const targetPath = platform.path.join(targetDir, entry.name);
    if (entry.isDirectory) {
      await copyDirectoryRecursive(sourcePath, targetPath, options);
      continue;
    }
    if (entry.isFile) {
      await platform.fs.copyFile(sourcePath, targetPath);
    }
  }
}
