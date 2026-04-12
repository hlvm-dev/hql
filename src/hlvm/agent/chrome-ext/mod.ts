/**
 * Chrome Extension Bridge — Barrel Re-export
 */

// Tool definitions for registry
export { CHROME_EXT_TOOLS } from "./tools.ts";

// Bridge (backend resolution & communication)
export {
  resolveChromeExtBackend,
  invalidateChromeExtResolution,
  getResolvedChromeExtBackend,
  chromeExtRequest,
} from "./bridge.ts";
export type { ChromeExtBackendResolution } from "./types.ts";

// Lock (uses shared SessionLock)
export {
  tryAcquireChromeExtLock,
  releaseChromeExtLock,
  checkChromeExtLock,
  isLockHeldLocally,
} from "./lock.ts";
export type { AcquireResult, CheckResult } from "./lock.ts";

// Session state
export { resetChromeExtSessionState } from "./session-state.ts";

// Setup & installation
export { installNativeHost, uninstallNativeHost, checkStatus } from "./setup.ts";

// Common paths & browser config
export {
  NATIVE_HOST_IDENTIFIER,
  detectAvailableBrowser,
  getAllNativeMessagingHostsDirs,
} from "./common.ts";

// System prompt
export { CHROME_EXT_SYSTEM_PROMPT } from "./prompt.ts";
