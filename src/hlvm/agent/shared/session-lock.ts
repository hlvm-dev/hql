// File-locking primitive shared between Computer Use and the Chrome extension.
// Uses an O_EXCL JSON lockfile, recovers stale locks left by dead PIDs, and reentrant within the same sessionId.

import { getPlatform } from "../../../platform/platform.ts";
import { getAgentLogger } from "../logger.ts";

interface LockData {
  readonly sessionId: string;
  readonly pid: number;
  readonly acquiredAt: number;
}

export type AcquireResult =
  | { readonly kind: "acquired"; readonly fresh: boolean }
  | { readonly kind: "blocked"; readonly by: string };

export type CheckResult =
  | { readonly kind: "free" }
  | { readonly kind: "held_by_self" }
  | { readonly kind: "blocked"; readonly by: string };

export interface SessionLockConfig {
  lockFilename: string;
  /** Fired once when this process actually wins the lock (not on reentrant re-acquire). */
  onAcquiredFresh: () => Promise<void> | void;
  onReleased: () => void;
}

export class SessionLock {
  private config: SessionLockConfig;
  private unregisterCleanup: (() => void) | undefined;
  private currentSessionId: string | undefined;
  private lockPathOverride: string | undefined;

  constructor(config: SessionLockConfig) {
    this.config = config;
  }

  /** @internal Override lock file path for test isolation. */
  _setLockPathForTests(path: string | undefined): void {
    this.lockPathOverride = path;
  }

  /** @internal Reset module-level state between tests. */
  _resetStateForTests(): void {
    this.unregisterCleanup?.();
    this.unregisterCleanup = undefined;
    this.currentSessionId = undefined;
  }

  private getLockPath(): string {
    if (this.lockPathOverride) return this.lockPathOverride;
    const platform = getPlatform();
    const home = platform.env.get("HOME") ?? "/tmp";
    return platform.path.join(home, ".hlvm", this.config.lockFilename);
  }

  private async readLock(): Promise<LockData | undefined> {
    try {
      const raw = await getPlatform().fs.readTextFile(this.getLockPath());
      const parsed: unknown = JSON.parse(raw);
      return isLockData(parsed) ? parsed : undefined;
    } catch {
      return undefined;
    }
  }

  private async tryCreateExclusive(lock: LockData): Promise<boolean> {
    try {
      await getPlatform().fs.writeTextFile(
        this.getLockPath(),
        JSON.stringify(lock),
        { createNew: true },
      );
      return true;
    } catch {
      return false;
    }
  }

  private async removeLockFile(): Promise<void> {
    try {
      await getPlatform().fs.remove(this.getLockPath());
    } catch { /* ignore */ }
  }

  private async recoverStaleLock(existing: LockData): Promise<void> {
    getAgentLogger().info(
      `Recovering stale ${this.config.lockFilename} from session ${existing.sessionId} (PID ${existing.pid})`,
    );
    await this.removeLockFile();
  }

  private registerCleanup(): void {
    this.unregisterCleanup?.();
    const handler = () => {
      this.release().catch(() => {});
    };
    try {
      globalThis.addEventListener("unload", handler);
      this.unregisterCleanup = () => {
        globalThis.removeEventListener("unload", handler);
      };
    } catch {
      this.unregisterCleanup = () => {};
    }
  }

  private async acquiredFresh(): Promise<AcquireResult> {
    await this.config.onAcquiredFresh();
    return { kind: "acquired", fresh: true };
  }

  private getSessionId(): string {
    return this.currentSessionId ?? "unknown";
  }

  setCurrentSessionId(sessionId: string): void {
    this.currentSessionId = sessionId;
  }

  isHeldLocally(): boolean {
    return this.unregisterCleanup !== undefined;
  }

  async check(): Promise<CheckResult> {
    const existing = await this.readLock();
    if (!existing) return { kind: "free" };
    if (existing.sessionId === this.getSessionId()) {
      return { kind: "held_by_self" };
    }
    if (await isProcessRunning(existing.pid)) {
      return { kind: "blocked", by: existing.sessionId };
    }
    await this.recoverStaleLock(existing);
    return { kind: "free" };
  }

  async acquire(sessionId: string): Promise<AcquireResult> {
    this.currentSessionId = sessionId;
    const platform = getPlatform();
    const lock: LockData = {
      sessionId,
      pid: platform.process.pid(),
      acquiredAt: Date.now(),
    };

    try {
      await platform.fs.mkdir(platform.path.dirname(this.getLockPath()), {
        recursive: true,
      });
    } catch { /* may already exist */ }

    if (await this.tryCreateExclusive(lock)) {
      this.registerCleanup();
      return await this.acquiredFresh();
    }

    const existing = await this.readLock();

    // Lock file exists but contents are unreadable — drop it and retry.
    if (!existing) {
      await this.removeLockFile();
      if (await this.tryCreateExclusive(lock)) {
        this.registerCleanup();
        return await this.acquiredFresh();
      }
      return {
        kind: "blocked",
        by: (await this.readLock())?.sessionId ?? "unknown",
      };
    }

    if (existing.sessionId === sessionId) {
      return { kind: "acquired", fresh: false };
    }

    if (await isProcessRunning(existing.pid)) {
      return { kind: "blocked", by: existing.sessionId };
    }

    await this.recoverStaleLock(existing);
    if (await this.tryCreateExclusive(lock)) {
      this.registerCleanup();
      return await this.acquiredFresh();
    }
    return {
      kind: "blocked",
      by: (await this.readLock())?.sessionId ?? "unknown",
    };
  }

  async release(): Promise<boolean> {
    this.unregisterCleanup?.();
    this.unregisterCleanup = undefined;

    const existing = await this.readLock();
    if (!existing || existing.sessionId !== this.getSessionId()) return false;
    try {
      await getPlatform().fs.remove(this.getLockPath());
      this.config.onReleased();
      getAgentLogger().debug(`Released ${this.config.lockFilename}`);
      return true;
    } catch {
      return false;
    }
  }
}

function isLockData(value: unknown): value is LockData {
  if (typeof value !== "object" || value === null) return false;
  return (
    "sessionId" in value &&
    typeof value.sessionId === "string" &&
    "pid" in value &&
    typeof value.pid === "number"
  );
}

async function isProcessRunning(pid: number): Promise<boolean> {
  try {
    const result = await getPlatform().command.output({
      cmd: ["kill", "-0", String(pid)],
      stdin: "null",
      stdout: "piped",
      stderr: "piped",
    });
    return result.success;
  } catch {
    return false;
  }
}
