/**
 * HLVM Ink REPL - Entry Point
 */

import React from "react";
import { render } from "ink";
import { App } from "./components/App.tsx";
import { ThemeProvider } from "../theme/index.ts";
import { parseSessionFlags, type SessionInitOptions } from "../repl/session/types.ts";
import { getPlatform } from "../../../platform/platform.ts";
import { log } from "../../api/log.ts";
import { createRuntimeConfigManager } from "../../runtime/model-config.ts";
import { setCurrentThemeName } from "../theme/state.ts";
import { setCustomKeybindingsSnapshot } from "./keybindings/custom-bindings.ts";
import { resetTerminalViewport } from "../ansi.ts";

export interface InkReplOptions {
  showBanner?: boolean;
  /** Session options for persistence */
  session?: SessionInitOptions;
}

export async function startInkRepl(options: InkReplOptions = {}): Promise<number> {
  if (!getPlatform().terminal.stdin.isTerminal()) {
    log.raw.error("Error: Requires interactive terminal.");
    return 1;
  }

  const { showBanner = true, session } = options;
  const runtimeConfig = await createRuntimeConfigManager();
  const runtimeSnapshot = await runtimeConfig.sync();
  const initialTheme = setCurrentThemeName(runtimeConfig.getTheme());
  setCustomKeybindingsSnapshot(runtimeSnapshot.keybindings);
  resetTerminalViewport();
  const { waitUntilExit } = render(
    <ThemeProvider initialTheme={initialTheme}>
      <App
        showBanner={showBanner}
        sessionOptions={session}
        initialConfig={runtimeSnapshot}
      />
    </ThemeProvider>
  );
  await waitUntilExit();
  return 0;
}

if (import.meta.main) {
  const args = getPlatform().process.args();

  startInkRepl({
    showBanner: !args.includes("--no-banner"),
    session: parseSessionFlags(args),
  }).then((code) => getPlatform().process.exit(code));
}
