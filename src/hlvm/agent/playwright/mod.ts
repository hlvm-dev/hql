/**
 * Playwright Browser Automation — Barrel Re-export
 */

// Tool definitions for registry
export { PLAYWRIGHT_TOOLS } from "./tools.ts";

// Browser lifecycle
export {
  _resetBrowserStateForTests,
  _testOnly,
  clearSnapshotRefsForSession,
  closeBrowser,
  closeBrowserTab,
  createBrowserTab,
  getOrCreatePage,
  isBrowserActive,
  isHeaded,
  listBrowserTabs,
  promoteToHeaded,
  replaceSnapshotRefs,
  resolveSnapshotRef,
  selectBrowserTab,
  startPlaywrightTraceCapture,
  stopPlaywrightTraceCapture,
} from "./browser-manager.ts";
