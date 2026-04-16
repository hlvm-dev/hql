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

export interface TuiV2Options {
  showBanner: boolean;
}

function App({ showBanner }: { showBanner: boolean }) {
  return (
    <Box flexDirection="column" paddingX={1}>
      {showBanner && (
        <Text bold>HLVM — High Level Virtual Machine</Text>
      )}
      <Box borderStyle="round" paddingX={1}>
        <Box marginRight={1}>
          <Text color="green">❯</Text>
        </Box>
        <Text dimColor>Ready</Text>
      </Box>
    </Box>
  );
}

export async function startTuiV2(options: TuiV2Options): Promise<number> {
  const { waitUntilExit } = renderSync(
    <App showBanner={options.showBanner} />,
    { patchConsole: false, exitOnCtrlC: true },
  );

  await waitUntilExit();
  return 0;
}
