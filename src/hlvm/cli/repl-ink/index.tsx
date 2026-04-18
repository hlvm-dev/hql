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
import { REPL_RENDER_OPTIONS } from "./render-options.ts";

export interface InkReplOptions {
  showBanner?: boolean;
  debug?: boolean;
}

export async function startInkRepl(
  options: InkReplOptions = {},
): Promise<number> {
  if (!getPlatform().terminal.stdin.isTerminal()) {
    log.raw.error("Error: Requires interactive terminal.");
    return 1;
  }

  const { showBanner = true, debug = false } = options;
  const runtimeConfig = await createRuntimeConfigManager();
  const runtimeSnapshot = await runtimeConfig.sync();
  const initialTheme = setCurrentThemeName(runtimeConfig.getTheme());
  setCustomKeybindingsSnapshot(runtimeSnapshot.keybindings);
  const { waitUntilExit } = render(
    <ThemeProvider initialTheme={initialTheme}>
      <App
        debug={debug}
        showBanner={showBanner}
        initialConfig={runtimeSnapshot}
      />
    </ThemeProvider>,
    REPL_RENDER_OPTIONS,
  );
  await waitUntilExit();
  return 0;
}

if (import.meta.main) {
  const args = getPlatform().process.args();

  startInkRepl({
    debug: args.includes("--debug"),
    showBanner: !args.includes("--no-banner"),
  }).then((code) => getPlatform().process.exit(code));
}
