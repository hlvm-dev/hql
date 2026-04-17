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
import {
  isFullscreenEnvEnabled,
  isMouseTrackingEnabled,
} from "./utils/fullscreen.ts";

export interface AppProps {
  showBanner: boolean;
}

export default function App({ showBanner }: AppProps) {
  // CC-parity: the outer shell runs flush-left (no horizontal padding) so
  // the prompt `❯`, pickers, and transcript rows align at column 0 like
  // CC. Keep `paddingY={1}` so the banner has breathing room above the
  // divider. Previously `paddingX={1}` added a 1-cell left indent to
  // every row, giving the whole shell a shifted-right look relative to CC.
  const shell = (
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

  const themed = <ThemeProvider>{shell}</ThemeProvider>;

  if (!isFullscreenEnvEnabled()) {
    return themed;
  }

  return (
    <AlternateScreen mouseTracking={isMouseTrackingEnabled()}>
      {themed}
    </AlternateScreen>
  );
}
