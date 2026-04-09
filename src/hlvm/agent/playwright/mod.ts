/**
 * Playwright Browser Automation — Barrel Re-export
 */

// Tool definitions for registry
export { PLAYWRIGHT_TOOLS } from "./tools.ts";

// Browser lifecycle
export {
  _resetBrowserStateForTests,
  _testOnly,
  closeBrowser,
  getOrCreatePage,
  isBrowserActive,
  isHeaded,
  promoteToHeaded,
} from "./browser-manager.ts";
