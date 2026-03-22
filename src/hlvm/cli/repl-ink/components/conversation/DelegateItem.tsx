import React from "react";
import { Box, Text } from "ink";
import { truncate } from "../../../../../common/utils.ts";
import { listDelegateTranscriptLines } from "../../../../agent/delegate-transcript.ts";
import { useSemanticColors } from "../../../theme/index.ts";
import type { DelegateItem as DelegateItemData } from "../../types.ts";
import { ChromeChip } from "../ChromeChip.tsx";
import {
  buildConversationSectionText,
  buildDelegateHeaderText,
  getDelegateStatusGlyph,
  getDelegateStatusTone,
} from "./conversation-chrome.ts";

interface DelegateItemProps {
  item: DelegateItemData;
  width: number;
  expanded?: boolean;
}

export const DelegateItem = React.memo(function DelegateItem(
  { item, width, expanded = false }: DelegateItemProps,
): React.ReactElement {
  const sc = useSemanticColors();
  const tone = getDelegateStatusTone(item.status);
  const accent = tone === "error"
    ? sc.status.error
    : tone === "success"
    ? sc.status.success
    : tone === "neutral"
    ? sc.text.muted
    : sc.status.warning;
  const icon = getDelegateStatusGlyph(item.status);
  const body = item.status === "error"
    ? item.error
    : item.status === "cancelled"
    ? "Cancelled"
    : item.summary;

  const headerLayout = buildDelegateHeaderText(
    {
      nickname: item.nickname,
      agent: item.agent,
      durationMs: item.durationMs,
      status: item.status,
    },
    Math.max(10, width - 8),
  );

  return (
    <Box flexDirection="row" width={width} marginBottom={1}>
      <Box width={4} flexShrink={0}>
        <Text color={accent} bold>{icon}</Text>
      </Box>
      <Box
        flexDirection="column"
        flexGrow={1}
        borderStyle="round"
        borderLeft
        borderRight={false}
        borderTop={false}
        borderBottom={false}
        borderColor={accent}
        paddingLeft={1}
      >
        <Box>
          <Text bold color={accent}>{headerLayout.leftText}</Text>
          {headerLayout.gapWidth > 0 && (
            <Text>{" ".repeat(headerLayout.gapWidth)}</Text>
          )}
          <Text color={sc.text.muted}>{headerLayout.rightText}</Text>
        </Box>
        <Text color={sc.text.secondary}>
          {truncate(item.task, Math.max(10, width - 8), "…")}
        </Text>
        {body && (
          <Text
            color={item.status === "error" ? sc.status.error : sc.text.muted}
          >
            {truncate(body, Math.max(10, width - 8), "…")}
          </Text>
        )}
        {item.childSessionId && (
          <Text color={sc.text.muted}>
            {truncate(
              `child session: ${item.childSessionId}`,
              Math.max(10, width - 8),
              "…",
            )}
          </Text>
        )}
        {expanded && item.snapshot && (
          <Box flexDirection="column" marginTop={1}>
            <Box marginBottom={0}>
              <ChromeChip text={` ${icon} transcript `} tone={tone} />
            </Box>
            <Text color={sc.chrome.sectionLabel}>
              {buildConversationSectionText("Events", Math.max(10, width - 8))}
            </Text>
            {listDelegateTranscriptLines(item.snapshot).map((line, index) => (
              <React.Fragment key={`${item.id}-event-${index}`}>
                <Text color={sc.text.muted}>
                  {truncate(
                    line,
                    Math.max(10, width - 8),
                    "…",
                  )}
                </Text>
              </React.Fragment>
            ))}
          </Box>
        )}
      </Box>
    </Box>
  );
});
