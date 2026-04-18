/**
 * Renders persisted reasoning/planning transcript entries.
 *
 * Compact inline text: · Thinking... or · Planning...
 * Uses static markers (no animated spinner) to avoid terminal redraws
 * that break text selection. The footer shows spinner activity instead.
 */

import React from "react";
import { Box, Text } from "ink";
import { useSemanticColors } from "../../../theme/index.ts";
import { STATUS_GLYPHS } from "../../ui-constants.ts";
import { getThinkingLabel } from "./conversation-chrome.ts";
import { TRANSCRIPT_LAYOUT } from "../../utils/layout-tokens.ts";
import { useConversationSpinnerFrame } from "../../hooks/useConversationMotion.ts";
import { getCcSpinnerVerb } from "./cc-turn-copy.ts";

interface ThinkingIndicatorProps {
  id: string;
  kind: "reasoning" | "planning";
  summary: string;
  iteration: number;
  expanded?: boolean;
  /** Whether the agent is actively processing (affects marker glyph) */
  isAnimating?: boolean;
}

export const ThinkingIndicator = React.memo(function ThinkingIndicator({
  id,
  kind,
  summary,
  iteration,
  expanded = false,
  isAnimating = true,
}: ThinkingIndicatorProps): React.ReactElement {
  const sc = useSemanticColors();
  const spinner = useConversationSpinnerFrame(isAnimating);
  const marker = isAnimating ? spinner ?? STATUS_GLYPHS.running : "\u00B7";
  const lines = summary ? summary.split("\n") : [];
  const body = expanded ? lines.join("\n").trim() : "";
  const title = getThinkingLabel(kind);
  const verb = React.useMemo(
    () => getCcSpinnerVerb(`${id}:${kind}:${iteration}`),
    [id, iteration, kind],
  );
  const label = isAnimating ? `${marker} ${verb}…` : `· ${title}`;

  return (
    <Box
      paddingLeft={TRANSCRIPT_LAYOUT.detailIndent}
      flexDirection="column"
    >
      <Box>
        <Text color={isAnimating ? sc.text.primary : sc.text.muted}>
          {label}
        </Text>
        {iteration > 1 && (
          <Text color={sc.text.muted}>{` (pass ${iteration})`}</Text>
        )}
      </Box>
      {body && (
        <Box paddingLeft={TRANSCRIPT_LAYOUT.detailIndent}>
          <Text color={sc.text.secondary} italic wrap="wrap">
            {body}
          </Text>
        </Box>
      )}
    </Box>
  );
});
