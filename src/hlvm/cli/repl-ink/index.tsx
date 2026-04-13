/**
 * HLVM Ink REPL - Entry Point
 */

import React from "react";
import { render } from "ink";
import { App } from "./components/App.tsx";
import { ThemeProvider } from "../theme/index.ts";
import { getPlatform } from "../../../platform/platform.ts";
import { log } from "../../api/log.ts";
import { createRuntimeConfigManager } from "../../runtime/model-config.ts";
import { setCurrentThemeName } from "../theme/state.ts";
import { setCustomKeybindingsSnapshot } from "./keybindings/custom-bindings.ts";
import {
  disableKittyKeyboardProtocol,
  enableKittyKeyboardProtocol,
  enterAlternateScreen,
  exitAlternateScreen,
  resetTerminalViewport,
} from "../ansi.ts";
import { REPL_RENDER_OPTIONS } from "./render-options.ts";

export interface InkReplOptions {
  showBanner?: boolean;
}

export async function startInkRepl(
  options: InkReplOptions = {},
): Promise<number> {
  if (!getPlatform().terminal.stdin.isTerminal()) {
    log.raw.error("Error: Requires interactive terminal.");
    return 1;
  }

  const { showBanner = true } = options;
  const runtimeConfig = await createRuntimeConfigManager();
  const runtimeSnapshot = await runtimeConfig.sync();
  const initialTheme = setCurrentThemeName(runtimeConfig.getTheme());
  setCustomKeybindingsSnapshot(runtimeSnapshot.keybindings);
  resetTerminalViewport();
  enableKittyKeyboardProtocol();
  enterAlternateScreen();
  try {
    const { waitUntilExit } = render(
      <ThemeProvider initialTheme={initialTheme}>
        <App
          showBanner={showBanner}
          initialConfig={runtimeSnapshot}
        />
      </ThemeProvider>,
      REPL_RENDER_OPTIONS,
    );
    await waitUntilExit();
    return 0;
  } finally {
    // Each cleanup is independent — one failing must not block the other,
    // or the terminal is left in a broken state (alt screen or kitty mode).
    try { exitAlternateScreen(); } catch { /* best-effort */ }
    try { disableKittyKeyboardProtocol(); } catch { /* best-effort */ }
  }
}

if (import.meta.main) {
  const args = getPlatform().process.args();

  startInkRepl({
    showBanner: !args.includes("--no-banner"),
  }).then((code) => getPlatform().process.exit(code));
}
