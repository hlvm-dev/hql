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
