import React from "react";
import { getPlatform } from "../../../platform/platform.ts";
import { useTerminalSize } from "../hooks/useTerminalSize.ts";
import Box from "../ink/components/Box.tsx";
import Text from "../ink/components/Text.tsx";
import { stringWidth } from "../ink/stringWidth.ts";
import { Clawd } from "./Clawd.tsx";
import { DONOR_INACTIVE } from "../theme/donorTheme.ts";

const DONOR_CLAUDE_CODE_VERSION = "2.1.94";
const DONOR_MODEL_AND_PLAN = "Opus 4.6 (1M context) · Claude Max";

function truncateEnd(value: string, width: number): string {
  if (width <= 0) return "";
  if (stringWidth(value) <= width) return value;
  if (width <= 1) return "…";
  return `${value.slice(0, Math.max(0, width - 1))}…`;
}

function truncatePath(path: string, width: number): string {
  if (width <= 0) return "";
  if (stringWidth(path) <= width) return path;
  if (width <= 1) return "…";

  const parts = path.split("/");
  let suffix = "";

  for (let index = parts.length - 1; index >= 0; index -= 1) {
    const segment = parts[index]!;
    const candidate = suffix.length === 0 ? segment : `${segment}/${suffix}`;
    if (stringWidth(`…/${candidate}`) > width) {
      return truncateEnd(`…/${suffix || segment}`, width);
    }
    suffix = candidate;
  }

  return truncateEnd(path, width);
}

function toHomeRelativePath(path: string): string {
  const home = getPlatform().env.get("HOME");
  if (!home || !path.startsWith(home)) return path;
  const suffix = path.slice(home.length);
  return suffix.length === 0 ? "~" : `~${suffix}`;
}

export function ClaudeBanner(): React.ReactNode {
  const { columns } = useTerminalSize();
  const cwd = toHomeRelativePath(getPlatform().process.cwd());
  const contentWidth = Math.max(columns - 15, 20);
  const versionLine = truncateEnd(
    DONOR_CLAUDE_CODE_VERSION,
    Math.max(contentWidth - 13, 6),
  );
  const modelLine = truncateEnd(DONOR_MODEL_AND_PLAN, contentWidth);
  const cwdLine = truncatePath(cwd, Math.max(contentWidth, 10));

  return (
    <Box flexDirection="row" gap={2} alignItems="center" marginBottom={1}>
      <Clawd />
      <Box flexDirection="column">
        <Text>
          <Text bold>Claude Code</Text>{" "}
          <Text color={DONOR_INACTIVE}>v{versionLine}</Text>
        </Text>
        <Text color={DONOR_INACTIVE}>{modelLine}</Text>
        <Text color={DONOR_INACTIVE}>{cwdLine}</Text>
      </Box>
    </Box>
  );
}
