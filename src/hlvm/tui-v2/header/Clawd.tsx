import React from "react";
import Box from "../ink/components/Box.tsx";
import Text from "../ink/components/Text.tsx";
import {
  DONOR_CLAWD_BACKGROUND,
  DONOR_CLAWD_BODY,
} from "../theme/donorTheme.ts";

export type ClawdPose =
  | "default"
  | "arms-up"
  | "look-left"
  | "look-right";

type Props = {
  pose?: ClawdPose;
};

type Segments = {
  r1L: string;
  r1E: string;
  r1R: string;
  r2L: string;
  r2R: string;
};

const POSES: Record<ClawdPose, Segments> = {
  default: {
    r1L: " ▐",
    r1E: "▛███▜",
    r1R: "▌",
    r2L: "▝▜",
    r2R: "▛▘",
  },
  "look-left": {
    r1L: " ▐",
    r1E: "▟███▟",
    r1R: "▌",
    r2L: "▝▜",
    r2R: "▛▘",
  },
  "look-right": {
    r1L: " ▐",
    r1E: "▙███▙",
    r1R: "▌",
    r2L: "▝▜",
    r2R: "▛▘",
  },
  "arms-up": {
    r1L: "▗▟",
    r1E: "▛███▜",
    r1R: "▙▖",
    r2L: " ▜",
    r2R: "▛ ",
  },
};

const APPLE_EYES: Record<ClawdPose, string> = {
  default: " ▗   ▖ ",
  "look-left": " ▘   ▘ ",
  "look-right": " ▝   ▝ ",
  "arms-up": " ▗   ▖ ",
};

function isAppleTerminal(): boolean {
  return process.env.TERM_PROGRAM === "Apple_Terminal";
}

function AppleTerminalClawd({ pose }: { pose: ClawdPose }): React.ReactNode {
  return (
    <Box flexDirection="column" alignItems="center">
      <Text>
        <Text color={DONOR_CLAWD_BODY}>▗</Text>
        <Text
          color={DONOR_CLAWD_BACKGROUND}
          backgroundColor={DONOR_CLAWD_BODY}
        >
          {APPLE_EYES[pose]}
        </Text>
        <Text color={DONOR_CLAWD_BODY}>▖</Text>
      </Text>
      <Text backgroundColor={DONOR_CLAWD_BODY}>{" ".repeat(7)}</Text>
      <Text color={DONOR_CLAWD_BODY}>▘▘ ▝▝</Text>
    </Box>
  );
}

export function Clawd({ pose = "default" }: Props): React.ReactNode {
  if (isAppleTerminal()) {
    return <AppleTerminalClawd pose={pose} />;
  }

  const p = POSES[pose];

  return (
    <Box flexDirection="column">
      <Text>
        <Text color={DONOR_CLAWD_BODY}>{p.r1L}</Text>
        <Text color={DONOR_CLAWD_BODY} backgroundColor={DONOR_CLAWD_BACKGROUND}>
          {p.r1E}
        </Text>
        <Text color={DONOR_CLAWD_BODY}>{p.r1R}</Text>
      </Text>
      <Text>
        <Text color={DONOR_CLAWD_BODY}>{p.r2L}</Text>
        <Text color={DONOR_CLAWD_BODY} backgroundColor={DONOR_CLAWD_BACKGROUND}>
          █████
        </Text>
        <Text color={DONOR_CLAWD_BODY}>{p.r2R}</Text>
      </Text>
      <Text color={DONOR_CLAWD_BODY}>{"  "}▘▘ ▝▝{"  "}</Text>
    </Box>
  );
}
