/**
 * HLVM Ink REPL - Entry Point
 */

import React from "npm:react@18";
import { render } from "npm:ink@5";
import { App } from "./components/App.tsx";
import { ThemeProvider } from "../theme/index.ts";
import type { SessionInitOptions } from "../repl/session/types.ts";

export interface InkReplOptions {
  jsMode?: boolean;
  showBanner?: boolean;
  /** Session options for persistence */
  session?: SessionInitOptions;
}

export async function startInkRepl(options: InkReplOptions = {}): Promise<number> {
  if (!Deno.stdin.isTerminal()) {
    console.error("Error: Requires interactive terminal.");
    return 1;
  }

  const { jsMode = false, showBanner = true, session } = options;
  const { waitUntilExit } = render(
    <ThemeProvider>
      <App jsMode={jsMode} showBanner={showBanner} sessionOptions={session} />
    </ThemeProvider>
  );
  await waitUntilExit();
  return 0;
}

if (import.meta.main) {
  const args = Deno.args;

  // Parse session flags
  let continueSession = false;
  let resumeId: string | undefined;
  let forceNew = false;
  let openPicker = false;

  if (args.includes("--continue") || args.includes("-c")) {
    continueSession = true;
  }
  const resumeIndex = args.findIndex((a) => a === "--resume" || a === "-r");
  if (resumeIndex !== -1) {
    const nextArg = args[resumeIndex + 1];
    if (nextArg && !nextArg.startsWith("-")) {
      resumeId = nextArg;
    } else {
      // --resume without id: open picker on startup
      openPicker = true;
    }
  }
  if (args.includes("--new")) {
    forceNew = true;
  }

  const sessionOptions: SessionInitOptions = {
    continue: continueSession,
    resumeId,
    forceNew,
    openPicker,
  };

  startInkRepl({
    jsMode: args.includes("--js"),
    showBanner: !args.includes("--no-banner"),
    session: sessionOptions,
  }).then(Deno.exit);
}
