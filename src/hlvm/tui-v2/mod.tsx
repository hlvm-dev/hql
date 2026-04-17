/** TUI v2 donor-engine baseline entry point. */

import React from "react";
import { renderSync } from "./ink/root.ts";
import App from "./App.tsx";

export interface TuiV2Options {
  showBanner: boolean;
}

// Defense against stderr text corrupting the ink-drawn screen:
// `patchConsole: true` makes ink pause rendering around any `console.*`
// write so the text appears cleanly above the current frame rather than
// overlapping cells. Combined with the underlying paste-handler setState
// fix (see src/hlvm/tui-v2/hooks/usePasteHandler.ts), this is enough to
// stop the "garbage text overlay" class of bug the user reported. We no
// longer need a custom console.error → log-file redirect (that path
// required direct Deno.openSync / FsFile, which violates the
// SSOT/platform-abstraction rule in CLAUDE.md).
export async function startTuiV2(options: TuiV2Options): Promise<number> {
  const { waitUntilExit } = renderSync(<App showBanner={options.showBanner} />, {
    patchConsole: true,
    exitOnCtrlC: true,
  });
  await waitUntilExit();
  return 0;
}
