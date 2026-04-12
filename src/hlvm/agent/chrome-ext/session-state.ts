/**
 * Chrome Extension Bridge — Session Runtime State
 *
 * Minimal state tracked on CLI side. The extension manages its own
 * tab/debugger state — CLI only needs to know session identity.
 */

import type { ChromeExtSessionState } from "./types.ts";

const state: ChromeExtSessionState = {
  attachedDebuggerTabs: new Set<number>(),
  monitoringEnabled: false,
};

export function getChromeExtSessionState(): ChromeExtSessionState {
  return state;
}

export function resetChromeExtSessionState(): void {
  state.attachedDebuggerTabs.clear();
  state.monitoringEnabled = false;
  delete state.activeTabId;
}
