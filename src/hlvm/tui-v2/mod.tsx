/** TUI v2 donor-engine baseline entry point. */

import React from "react";
import { renderSync } from "./ink/root.ts";
import App from "./App.tsx";

export interface TuiV2Options {
  showBanner: boolean;
}

export async function startTuiV2(options: TuiV2Options): Promise<number> {
  const { waitUntilExit } = renderSync(<App showBanner={options.showBanner} />, {
    patchConsole: false,
    exitOnCtrlC: true,
  });
  await waitUntilExit();
  return 0;
}
