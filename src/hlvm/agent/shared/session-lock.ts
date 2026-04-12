/**
 * Generic Session Lock — Shared by CU and Chrome Extension
 *
 * Extracted from computer-use/lock.ts to eliminate DRY violation.
 * Both CU and Chrome-ext locks use identical logic with different:
 *   - Lock filename
 *   - onAcquiredFresh callback
 *   - onReleased callback
 *
 * All TS logic (O_EXCL check-and-write, reentrance, stale recovery,
 * AcquireResult/CheckResult unions) is parameterized, not duplicated.
 */

import { getPlatform } from "../../../platform/platform.ts";
import { getAgentLogger } from "../logger.ts";

// ── Types ───────────────────────────────────────────────────────────

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
  /** Lock filename (e.g. "computer-use.lock", "chrome-ext.lock") */
  lockFilename: string;
  /** Called on fresh acquisition (invalidate caches, resolve backend, etc.) */
  onAcquiredFresh: () => Promise<void> | void;
  /** Called on release (reset session state, etc.) */
  onReleased: () => void;
}

// ── SessionLock class ───────────────────────────────────────────────

export class SessionLock {
  private config: SessionLockConfig;
  private unregisterCleanup: (() => void) | undefined;
  private currentSessionId: string | undefined;
  private lockPathOverride: string | undefined;

  constructor(config: SessionLockConfig) {
    this.config = config;
  }

  // ── Test isolation ──────────────────────────────────────────────

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

  // ── Internals ─────────────────────────────────────────────────

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

  // ── Public API ────────────────────────────────────────────────

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
    getAgentLogger().info(
      `Recovering stale ${this.config.lockFilename} from session ${existing.sessionId} (PID ${existing.pid})`,
    );
    try {
      await getPlatform().fs.remove(this.getLockPath());
    } catch { /* ignore */ }
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

    const dir = platform.path.dirname(this.getLockPath());
    try {
      await platform.fs.mkdir(dir, { recursive: true });
    } catch { /* may already exist */ }

    if (await this.tryCreateExclusive(lock)) {
      this.registerCleanup();
      return await this.acquiredFresh();
    }

    const existing = await this.readLock();

    if (!existing) {
      try {
        await platform.fs.remove(this.getLockPath());
      } catch { /* ignore */ }
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

    getAgentLogger().info(
      `Recovering stale ${this.config.lockFilename} from session ${existing.sessionId} (PID ${existing.pid})`,
    );
    try {
      await platform.fs.remove(this.getLockPath());
    } catch { /* ignore */ }
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

// ── Shared Helpers ──────────────────────────────────────────────────

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
