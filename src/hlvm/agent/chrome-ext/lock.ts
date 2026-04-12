/**
 * Chrome Extension Bridge — Session Lock
 *
 * Thin wrapper over shared SessionLock with chrome-ext-specific callbacks.
 */

import { SessionLock } from "../shared/session-lock.ts";
import { invalidateChromeExtResolution } from "./bridge.ts";
import { resetChromeExtSessionState } from "./session-state.ts";

export type { AcquireResult, CheckResult } from "../shared/session-lock.ts";

const lock = new SessionLock({
  lockFilename: "chrome-ext.lock",
  onAcquiredFresh: () => {
    invalidateChromeExtResolution();
    resetChromeExtSessionState();
  },
  onReleased: () => {
    resetChromeExtSessionState();
  },
});

export const tryAcquireChromeExtLock = (sessionId: string) =>
  lock.acquire(sessionId);
export const releaseChromeExtLock = () => lock.release();
export const checkChromeExtLock = () => lock.check();
export const isLockHeldLocally = () => lock.isHeldLocally();
export const setCurrentSessionId = (id: string) =>
  lock.setCurrentSessionId(id);

// Test isolation
export const _setLockPathForTests = (p: string | undefined) =>
  lock._setLockPathForTests(p);
export const _resetLockStateForTests = () => lock._resetStateForTests();
