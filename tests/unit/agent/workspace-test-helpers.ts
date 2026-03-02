import { getPlatform } from "../../../src/platform/platform.ts";

export async function ensureWorkspaceDir(workspacePath: string): Promise<void> {
  const platform = getPlatform();
  try {
    await platform.fs.mkdir(workspacePath, { recursive: true });
  } catch {
    // Workspace might already exist or be concurrently created.
  }
}

export async function cleanupWorkspaceDir(workspacePath: string): Promise<void> {
  const platform = getPlatform();
  try {
    await platform.fs.remove(workspacePath, { recursive: true });
  } catch {
    // Ignore cleanup errors in tests.
  }
}
