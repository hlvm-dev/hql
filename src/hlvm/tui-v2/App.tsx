import React from "react";
import { AlternateScreen } from "./ink/components/AlternateScreen.tsx";
import Box from "./ink/components/Box.tsx";
// SSOT: reuse v1's Banner component directly. v1's Banner renders the
// canonical big HLVM block-ASCII logo with the purple→orange gradient and
// the `HLVM 0.1.0 — High Level Virtual Machine` subtitle. Previously v2
// used its own compact CC-shaped glyph which drifted from the SSOT.
import { Banner as HLVMBanner } from "../cli/repl-ink/components/Banner.tsx";
import { TranscriptWorkbench } from "./transcript/TranscriptWorkbench.tsx";
// SSOT: reuse v1's ThemeProvider so any v1 component reused in v2 (via the
// bare-`ink` barrel) finds the theme context at the top of the tree. This
// is the same provider v1's `repl-ink/index.tsx` mounts at its own root.
import { ThemeProvider } from "../cli/theme/index.ts";
// CC-parity: auto-copy the selection to the clipboard at drag-release
// so Cmd+C in the host terminal (macOS Terminal / iTerm2) finds the
// selected text ready to paste. CC wires the equivalent hook at its
// shell root; without it, v2's mouse tracking would capture the drag
// and leave the clipboard empty, producing the "Cmd+C beep" the user
// reported.
import { useCopyOnSelect } from "./hooks/useCopyOnSelect.ts";
import {
  isFullscreenEnvEnabled,
  isMouseTrackingEnabled,
} from "./utils/fullscreen.ts";

export interface AppProps {
  showBanner: boolean;
}

function Shell({ showBanner }: AppProps): React.ReactElement {
  // useCopyOnSelect must be called inside a component so it gets the
  // StdinContext that `useSelection()` depends on. Kept here (rather
  // than in the default-export App) because the hooks require the Ink
  // instance to be mounted, which only happens once the tree is inside
  // AlternateScreen.
  useCopyOnSelect();
  return (
    <Box
      flexDirection="column"
      height="100%"
      width="100%"
      paddingY={1}
    >
      {showBanner && <HLVMBanner errors={[]} />}
      <TranscriptWorkbench />
    </Box>
  );
}

export default function App({ showBanner }: AppProps) {
  // CC-parity: the outer shell runs flush-left (no horizontal padding) so
  // the prompt `❯`, pickers, and transcript rows align at column 0 like
  // CC. Keep `paddingY={1}` so the banner has breathing room above the
  // divider. Previously `paddingX={1}` added a 1-cell left indent to
  // every row, giving the whole shell a shifted-right look relative to CC.
  const themed = (
    <ThemeProvider>
      <Shell showBanner={showBanner} />
    </ThemeProvider>
  );

  if (!isFullscreenEnvEnabled()) {
    return themed;
  }

  return (
    <AlternateScreen mouseTracking={isMouseTrackingEnabled()}>
      {themed}
    </AlternateScreen>
  );
}
