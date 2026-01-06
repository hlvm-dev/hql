/**
 * HQL Ink REPL - Entry Point
 */

import React from "npm:react@18";
import { render } from "npm:ink@5";
import { App } from "./components/App.tsx";

export interface InkReplOptions {
  jsMode?: boolean;
  showBanner?: boolean;
}

export async function startInkRepl(options: InkReplOptions = {}): Promise<number> {
  if (!Deno.stdin.isTerminal()) {
    console.error("Error: Requires interactive terminal.");
    return 1;
  }

  const { jsMode = false, showBanner = true } = options;
  const { waitUntilExit } = render(<App jsMode={jsMode} showBanner={showBanner} />);
  await waitUntilExit();
  return 0;
}

if (import.meta.main) {
  const args = Deno.args;
  startInkRepl({
    jsMode: args.includes("--js"),
    showBanner: !args.includes("--no-banner"),
  }).then(Deno.exit);
}
