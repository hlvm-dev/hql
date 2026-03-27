import React from "react";
import { Box, Text } from "ink";
import { truncate } from "../../../../../common/utils.ts";
import { useSemanticColors } from "../../../theme/index.ts";
import type { StructuredTeamInfoItem } from "../../types.ts";
import {
  getTeamMessageGlyph,
  getTeamMessageTone,
  getTeamPlanReviewGlyph,
  getTeamPlanReviewTone,
  getTeamShutdownGlyph,
  getTeamShutdownTone,
  getTeamTaskStatusGlyph,
  getTeamTaskStatusTone,
} from "./conversation-chrome.ts";
import { TRANSCRIPT_LAYOUT } from "../../utils/layout-tokens.ts";

interface TeamEventItemProps {
  item: StructuredTeamInfoItem;
  width: number;
}

export const TeamEventItem = React.memo(function TeamEventItem(
  { item, width }: TeamEventItemProps,
): React.ReactElement {
  const sc = useSemanticColors();
  const maxTextWidth = Math.max(
    10,
    width - 4 - TRANSCRIPT_LAYOUT.detailIndent,
  );

  const renderLine = (
    glyph: string,
    toneColor: string,
    summary: string,
  ): React.ReactElement => (
    <Box paddingLeft={TRANSCRIPT_LAYOUT.detailIndent}>
      <Text color={toneColor}>{glyph}</Text>
      <Text color={toneColor}>{" "}</Text>
      <Text color={sc.text.muted}>{truncate(summary, maxTextWidth, "…")}</Text>
    </Box>
  );

  switch (item.teamEventType) {
    case "team_task_updated": {
      const glyph = getTeamTaskStatusGlyph(item.status);
      const tone = getTeamTaskStatusTone(item.status);
      const color = tone === "error"
        ? sc.status.error
        : tone === "success"
        ? sc.status.success
        : sc.status.warning;
      return renderLine(
        glyph,
        color,
        `Task #${item.taskId} · ${item.goal}${
          item.assigneeMemberId ? ` · ${item.assigneeMemberId}` : ""
        }`,
      );
    }

    case "team_message": {
      const tone = getTeamMessageTone(item.kind);
      const glyph = getTeamMessageGlyph(item.kind);
      const color = tone === "error"
        ? sc.status.error
        : tone === "success"
        ? sc.status.success
        : sc.text.secondary;
      return renderLine(
        glyph,
        color,
        item.toMemberId
          ? `${item.fromMemberId} → ${item.toMemberId} · ${item.contentPreview}`
          : `${item.fromMemberId} broadcast · ${item.contentPreview}`,
      );
    }

    case "team_member_activity": {
      const color = item.status === "error"
        ? sc.status.error
        : item.status === "success"
        ? sc.status.success
        : sc.text.secondary;
      return renderLine(
        ">",
        color,
        `${item.memberLabel} · ${item.summary}`,
      );
    }

    case "team_plan_review": {
      const tone = getTeamPlanReviewTone(item.status);
      const glyph = getTeamPlanReviewGlyph(item.status);
      const color = tone === "error"
        ? sc.status.error
        : tone === "success"
        ? sc.status.success
        : sc.status.warning;
      return renderLine(
        glyph,
        color,
        `Plan review · Task #${item.taskId} · ${item.submittedByMemberId}${
          item.reviewedByMemberId
            ? ` · reviewed by ${item.reviewedByMemberId}`
            : ""
        }`,
      );
    }

    case "team_shutdown": {
      const tone = getTeamShutdownTone(item.status);
      const glyph = getTeamShutdownGlyph(item.status);
      const color = tone === "error"
        ? sc.status.error
        : tone === "success"
        ? sc.status.success
        : sc.status.warning;
      return renderLine(
        glyph,
        color,
        `Shutdown ${item.status} · ${item.memberId} · requested by ${item.requestedByMemberId}${
          item.reason ? ` · ${item.reason}` : ""
        }`,
      );
    }

    case "team_runtime_snapshot":
      // Filtered out by timeline visibility rules; fallback to nothing
      return <Box />;
  }
});
