import React from "react";
import { Box, Text } from "ink";
import { truncate } from "../../../../../common/utils.ts";
import { listDelegatePreviewLines } from "../../../../agent/delegate-transcript.ts";
import { useSemanticColors } from "../../../theme/index.ts";
import type { DelegateItem as DelegateItemData } from "../../types.ts";
import {
  buildDelegateHeaderText,
  getDelegateStatusGlyph,
  getDelegateStatusTone,
} from "./conversation-chrome.ts";
import { TRANSCRIPT_LAYOUT } from "../../utils/layout-tokens.ts";

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
    <Box flexDirection="column" width={width} marginBottom={1}>
      <Box
        flexDirection="row"
        paddingLeft={TRANSCRIPT_LAYOUT.detailIndent}
        width={width}
      >
        <Text color={accent} bold>{icon}</Text>
        <Text color={accent}>{" "}</Text>
        <Text bold color={accent}>
          {truncate(
            `${headerLayout.leftText} · ${item.task}`,
            Math.max(10, width - 4 - TRANSCRIPT_LAYOUT.detailIndent),
            "…",
          )}
        </Text>
        {headerLayout.rightText && (
          <>
            <Text color={sc.text.muted}>{" "}</Text>
            <Text color={sc.text.muted}>{headerLayout.rightText}</Text>
          </>
        )}
      </Box>
      {expanded && (
        <Box
          flexDirection="column"
          paddingLeft={TRANSCRIPT_LAYOUT.detailIndent * 2}
          marginTop={1}
        >
          {body && (
            <Text
              color={item.status === "error" ? sc.status.error : sc.text.muted}
              wrap="wrap"
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
          {item.snapshot &&
            listDelegatePreviewLines(item.snapshot).map((line, index) => (
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
  );
});
