/**
 * Playwright Browser Automation — Barrel Re-export
 */

// Tool definitions for registry
export { PLAYWRIGHT_TOOLS } from "./tools.ts";

// Browser lifecycle
export { closeBrowser, isBrowserActive, isHeaded, getOrCreatePage, promoteToHeaded } from "./browser-manager.ts";
