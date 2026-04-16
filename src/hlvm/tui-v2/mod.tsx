/**
 * TUI v2 — Entry point
 *
 * Renders the new Ink-based terminal UI for HLVM.
 * Launch via: hlvm repl --new
 */

import React from "react";
import { renderSync } from "./ink/root.ts";
import Box from "./ink/components/Box.tsx";
import Text from "./ink/components/Text.tsx";
import { AppStateProvider } from "./state/context.tsx";
import { KeybindingProvider } from "./keybindings/context.tsx";
import App from "./App.tsx";

export interface TuiV2Options {
  showBanner: boolean;
}

export async function startTuiV2(options: TuiV2Options): Promise<number> {
  function Root() {
    return (
      <KeybindingProvider>
        <AppStateProvider>
          <Box flexDirection="column">
            {options.showBanner && (
              <Box paddingX={1} marginBottom={1}>
                <Text bold color="cyan">HLVM</Text>
                <Text dimColor>{" — High Level Virtual Machine"}</Text>
              </Box>
            )}
            <App />
          </Box>
        </AppStateProvider>
      </KeybindingProvider>
    );
  }

  const { waitUntilExit } = renderSync(<Root />, {
    patchConsole: false,
    exitOnCtrlC: true,
  });
  await waitUntilExit();
  return 0;
}
