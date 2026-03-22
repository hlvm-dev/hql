import React from "react";
import { Box, Text } from "ink";
import { truncate } from "../../../../../common/utils.ts";
import { useSemanticColors } from "../../../theme/index.ts";
import type { StructuredTeamInfoItem } from "../../types.ts";
import { ConversationCallout } from "./ConversationCallout.tsx";
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

interface TeamEventItemProps {
  item: StructuredTeamInfoItem;
  width: number;
}

export const TeamEventItem = React.memo(function TeamEventItem(
  { item, width }: TeamEventItemProps,
): React.ReactElement {
  const sc = useSemanticColors();
  const maxTextWidth = Math.max(10, width - 8);

  switch (item.teamEventType) {
    case "team_task_updated": {
      const tone = getTeamTaskStatusTone(item.status);
      const glyph = getTeamTaskStatusGlyph(item.status);
      return (
        <ConversationCallout
          title={`${glyph} Task #${item.taskId}`}
          tone={tone}
        >
          <Text color={sc.text.secondary}>
            {truncate(item.goal, maxTextWidth, "…")}
          </Text>
          {item.assigneeMemberId && (
            <Text color={sc.text.muted}>
              Assignee: {item.assigneeMemberId}
            </Text>
          )}
        </ConversationCallout>
      );
    }

    case "team_message": {
      const tone = getTeamMessageTone(item.kind);
      const glyph = getTeamMessageGlyph(item.kind);
      const header = item.toMemberId
        ? `${glyph} ${item.fromMemberId} → ${item.toMemberId}`
        : `${glyph} ${item.fromMemberId} (broadcast)`;
      return (
        <ConversationCallout title={header} tone={tone}>
          <Text color={sc.text.muted}>
            {truncate(item.contentPreview, maxTextWidth, "…")}
          </Text>
        </ConversationCallout>
      );
    }

    case "team_plan_review": {
      const tone = getTeamPlanReviewTone(item.status);
      const glyph = getTeamPlanReviewGlyph(item.status);
      return (
        <ConversationCallout title={`${glyph} Plan Review`} tone={tone}>
          <Text color={sc.text.secondary}>
            Task #{item.taskId} · Submitted by: {item.submittedByMemberId}
          </Text>
          {item.reviewedByMemberId && (
            <Text color={sc.text.muted}>
              Reviewed by: {item.reviewedByMemberId}
            </Text>
          )}
        </ConversationCallout>
      );
    }

    case "team_shutdown": {
      const tone = getTeamShutdownTone(item.status);
      const glyph = getTeamShutdownGlyph(item.status);
      return (
        <ConversationCallout
          title={`${glyph} Shutdown ${item.status}`}
          tone={tone}
        >
          <Text color={sc.text.secondary}>
            Member: {item.memberId} · Requested by: {item.requestedByMemberId}
          </Text>
          {item.reason && (
            <Text color={sc.text.muted}>
              {truncate(`Reason: ${item.reason}`, maxTextWidth, "…")}
            </Text>
          )}
        </ConversationCallout>
      );
    }

    case "team_runtime_snapshot":
      // Filtered out by shouldRenderConversationItem; fallback to nothing
      return <Box />;
  }
});
