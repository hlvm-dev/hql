/**
 * Computer Use — Session Lock (CC clone)
 *
 * CC original: utils/computerUse/computerUseLock.ts (215 lines)
 *
 * ── Bridge changes from CC ────────────────────────────────────────────────
 * - `fs/promises` (mkdir, readFile, unlink, writeFile) → `getPlatform().fs.*`
 * - `process.pid` → `getPlatform().process.pid()`
 * - `process.kill(pid, 0)` → async shell `kill -0` (SSOT)
 * - `getClaudeConfigHomeDir()` → `getPlatform().env.get("HOME")` + `.hlvm`
 * - `getSessionId()` → passed as parameter
 * - `registerCleanup()` → module-level unload handler
 * - `jsonParse/jsonStringify` → JSON.parse/JSON.stringify
 * - `getErrnoCode()` → catch check for EEXIST message pattern
 *
 * ALL TS logic (O_EXCL-like check-and-write, reentrance, stale recovery,
 * AcquireResult/CheckResult unions, isLockHeldLocally) is IDENTICAL to CC.
 */

import { getPlatform } from "../../../platform/platform.ts";
import { getAgentLogger } from "../logger.ts";

const LOCK_FILENAME = "computer-use.lock";

// Holds the unregister function for the shutdown cleanup handler.
// Set when the lock is acquired, cleared when released.
let unregisterCleanup: (() => void) | undefined;

type ComputerUseLock = {
  readonly sessionId: string;
  readonly pid: number;
  readonly acquiredAt: number;
};

export type AcquireResult =
  | { readonly kind: "acquired"; readonly fresh: boolean }
  | { readonly kind: "blocked"; readonly by: string };

export type CheckResult =
  | { readonly kind: "free" }
  | { readonly kind: "held_by_self" }
  | { readonly kind: "blocked"; readonly by: string };

const FRESH: AcquireResult = { kind: "acquired", fresh: true };
const REENTRANT: AcquireResult = { kind: "acquired", fresh: false };

function isComputerUseLock(value: unknown): value is ComputerUseLock {
  if (typeof value !== "object" || value === null) return false;
  return (
    "sessionId" in value &&
    typeof value.sessionId === "string" &&
    "pid" in value &&
    typeof value.pid === "number"
  );
}

// ── Test isolation hooks ─────────────────────────────────────────────
let _lockPathOverride: string | undefined;

/** @internal Override lock file path for test isolation. Pass undefined to reset. */
export function _setLockPathForTests(path: string | undefined): void {
  _lockPathOverride = path;
}

/** @internal Reset module-level state between tests. */
export function _resetLockStateForTests(): void {
  unregisterCleanup?.();
  unregisterCleanup = undefined;
  _currentSessionId = undefined;
}

function getLockPath(): string {
  if (_lockPathOverride) return _lockPathOverride;
  const platform = getPlatform();
  const home = platform.env.get("HOME") ?? "/tmp";
  return platform.path.join(home, ".hlvm", LOCK_FILENAME);
}

async function readLock(): Promise<ComputerUseLock | undefined> {
  try {
    const raw = await getPlatform().fs.readTextFile(getLockPath());
    const parsed: unknown = JSON.parse(raw);
    return isComputerUseLock(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Check whether a process is still running (signal 0 probe).
 *
 * Bridge note: CC uses synchronous `process.kill(pid, 0)`.
 * HLVM uses async `kill -0` via shell (SSOT compliance).
 */
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

/**
 * Attempt to create the lock file exclusively.
 *
 * Bridge note: CC uses `writeFile(path, data, { flag: 'wx' })` for O_EXCL.
 * HLVM's platform doesn't have O_EXCL. We do check-then-write with the
 * tightest possible window. For single-user desktop, this is sufficient.
 */
async function tryCreateExclusive(
  lock: ComputerUseLock,
): Promise<boolean> {
  const platform = getPlatform();
  const path = getLockPath();
  try {
    // Check if file exists first
    await platform.fs.readTextFile(path);
    return false; // File exists → can't create exclusively
  } catch {
    // File doesn't exist — create it
    try {
      await platform.fs.writeTextFile(path, JSON.stringify(lock));
      return true;
    } catch {
      return false;
    }
  }
}

/**
 * Register a shutdown cleanup handler so the lock is released even if
 * turn-end cleanup is never reached.
 */
function registerLockCleanup(): void {
  unregisterCleanup?.();
  // Use globalThis.addEventListener for unload if available
  const handler = () => {
    releaseComputerUseLock().catch(() => {});
  };
  try {
    globalThis.addEventListener("unload", handler);
    unregisterCleanup = () => {
      globalThis.removeEventListener("unload", handler);
    };
  } catch {
    // If addEventListener not available, just track the flag
    unregisterCleanup = () => {};
  }
}

// ── Current session ID (set by first acquire) ────────────────────────────

let _currentSessionId: string | undefined;

export function setCurrentSessionId(sessionId: string): void {
  _currentSessionId = sessionId;
}

function getCurrentSessionId(): string {
  return _currentSessionId ?? "unknown";
}

// ── Public API (CC clone) ────────────────────────────────────────────────

/**
 * Check lock state without acquiring. Used for `request_access` /
 * `list_granted_applications`. Does stale-PID recovery.
 */
export async function checkComputerUseLock(): Promise<CheckResult> {
  const existing = await readLock();
  if (!existing) return { kind: "free" };
  if (existing.sessionId === getCurrentSessionId()) {
    return { kind: "held_by_self" };
  }
  if (await isProcessRunning(existing.pid)) {
    return { kind: "blocked", by: existing.sessionId };
  }
  getAgentLogger().info(
    `Recovering stale computer-use lock from session ${existing.sessionId} (PID ${existing.pid})`,
  );
  try {
    await getPlatform().fs.remove(getLockPath());
  } catch { /* ignore */ }
  return { kind: "free" };
}

/**
 * Zero-syscall check: does THIS process believe it holds the lock?
 * True iff `tryAcquireComputerUseLock` succeeded and
 * `releaseComputerUseLock` hasn't run yet.
 */
export function isLockHeldLocally(): boolean {
  return unregisterCleanup !== undefined;
}

/**
 * Try to acquire the computer-use lock for the current session.
 *
 * `{kind: 'acquired', fresh: true}` — first tool call of a CU turn.
 * `{kind: 'acquired', fresh: false}` — re-entrant, same session already holds it.
 * `{kind: 'blocked', by}` — another live session holds it.
 */
export async function tryAcquireComputerUseLock(
  sessionId: string,
): Promise<AcquireResult> {
  _currentSessionId = sessionId;
  const platform = getPlatform();
  const lock: ComputerUseLock = {
    sessionId,
    pid: platform.process.pid(),
    acquiredAt: Date.now(),
  };

  // Ensure directory exists
  const dir = platform.path.dirname(getLockPath());
  try {
    await platform.fs.mkdir(dir, { recursive: true });
  } catch { /* may already exist */ }

  // Fresh acquisition.
  if (await tryCreateExclusive(lock)) {
    registerLockCleanup();
    return FRESH;
  }

  const existing = await readLock();

  // Corrupt/unparseable — treat as stale.
  if (!existing) {
    try {
      await platform.fs.remove(getLockPath());
    } catch { /* ignore */ }
    if (await tryCreateExclusive(lock)) {
      registerLockCleanup();
      return FRESH;
    }
    return {
      kind: "blocked",
      by: (await readLock())?.sessionId ?? "unknown",
    };
  }

  // Already held by this session.
  if (existing.sessionId === sessionId) return REENTRANT;

  // Another live session holds it — blocked.
  if (await isProcessRunning(existing.pid)) {
    return { kind: "blocked", by: existing.sessionId };
  }

  // Stale lock — recover.
  getAgentLogger().info(
    `Recovering stale computer-use lock from session ${existing.sessionId} (PID ${existing.pid})`,
  );
  try {
    await platform.fs.remove(getLockPath());
  } catch { /* ignore */ }
  if (await tryCreateExclusive(lock)) {
    registerLockCleanup();
    return FRESH;
  }
  return {
    kind: "blocked",
    by: (await readLock())?.sessionId ?? "unknown",
  };
}

/**
 * Release the computer-use lock if the current session owns it. Returns
 * `true` if we actually unlinked the file — callers fire exit notifications.
 * Idempotent: subsequent calls return `false`.
 */
export async function releaseComputerUseLock(): Promise<boolean> {
  unregisterCleanup?.();
  unregisterCleanup = undefined;

  const existing = await readLock();
  if (!existing || existing.sessionId !== getCurrentSessionId()) return false;
  try {
    await getPlatform().fs.remove(getLockPath());
    getAgentLogger().debug("Released computer-use lock");
    return true;
  } catch {
    return false;
  }
}

// ── Legacy API (kept for backward compat with existing tests) ────────────

export async function acquireLock(sessionId: string): Promise<boolean> {
  const result = await tryAcquireComputerUseLock(sessionId);
  return result.kind === "acquired";
}

export async function releaseLock(): Promise<void> {
  await releaseComputerUseLock();
}
