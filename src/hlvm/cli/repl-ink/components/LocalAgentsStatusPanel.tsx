import React from "react";
import { Box, Text } from "ink";
import { truncate } from "../../../../common/utils.ts";
import { useSemanticColors } from "../../theme/index.ts";
import { formatDurationMs } from "../utils/formatting.ts";
import type { LocalAgentEntry } from "../utils/local-agents.ts";

const MAX_VISIBLE_LOCAL_AGENTS = 4;
const MAX_PREVIEW_LINES = 3;

type AgentRowTone = "active" | "warning" | "success" | "error" | "muted";

export interface LocalAgentsLeaderState {
  activityText?: string;
  idleText?: string;
  tokenCount?: number;
}

interface LocalAgentsLeaderRow {
  treePrefix: string;
  name: string;
  bodyText: string;
  metricsText?: string;
  hintText?: string;
  highlighted: boolean;
}

interface LocalAgentsAgentRow {
  id: string;
  treePrefix: string;
  previewPrefix: string;
  name: string;
  bodyText: string;
  metricsText?: string;
  previewLines: string[];
  tone: AgentRowTone;
}

export interface LocalAgentsStatusPanelModel {
  leader: LocalAgentsLeaderRow;
  agents: LocalAgentsAgentRow[];
  overflow?: string;
  rowCount: number;
}

function formatCount(value: number): string {
  return value.toLocaleString("en-US");
}

function formatMetrics(entry: LocalAgentEntry): string | undefined {
  const parts: string[] = [];
  if (entry.progress?.toolUseCount) {
    const toolUseCount = entry.progress.toolUseCount;
    parts.push(
      `${toolUseCount} tool ${toolUseCount === 1 ? "use" : "uses"}`,
    );
  }
  if (entry.progress?.tokenCount) {
    parts.push(`${formatCount(entry.progress.tokenCount)} tokens`);
  }
  if (entry.progress?.durationMs != null && entry.progress.durationMs >= 1000) {
    parts.push(formatDurationMs(entry.progress.durationMs));
  }
  return parts.length > 0 ? ` · ${parts.join(" · ")}` : undefined;
}

function formatLeaderMetrics(
  leader: LocalAgentsLeaderState | undefined,
): string | undefined {
  if (!leader?.tokenCount || leader.tokenCount <= 0) return undefined;
  return ` · ${formatCount(leader.tokenCount)} tokens`;
}

function statusTone(status: LocalAgentEntry["status"]): AgentRowTone {
  switch (status) {
    case "waiting":
      return "warning";
    case "completed":
      return "success";
    case "failed":
      return "error";
    case "blocked":
    case "cancelled":
      return "muted";
    default:
      return "active";
  }
}

function toneColor(
  tone: AgentRowTone,
  colors: ReturnType<typeof useSemanticColors>,
): string {
  switch (tone) {
    case "warning":
      return colors.status.warning;
    case "success":
      return colors.status.success;
    case "error":
      return colors.status.error;
    case "muted":
      return colors.text.muted;
    case "active":
    default:
      return colors.text.primary;
  }
}

function buildLeaderText(
  entries: LocalAgentEntry[],
  leader: LocalAgentsLeaderState | undefined,
  focused: boolean,
): LocalAgentsLeaderRow {
  const hintText = focused
    ? entries.length === 1 ? " · enter to view · esc back" : " · enter to manage · esc back"
    : undefined;
  return {
    treePrefix: focused ? "╒═" : "┌─",
    name: "team-lead",
    bodyText: leader?.activityText?.trim() ||
      leader?.idleText?.trim() ||
      "Coordinating teammates",
    metricsText: formatLeaderMetrics(leader),
    hintText,
    highlighted: focused,
  };
}

function buildAgentText(
  entry: LocalAgentEntry,
  index: number,
  visibleCount: number,
  hasOverflow: boolean,
): LocalAgentsAgentRow {
  const isLastVisible = index === visibleCount - 1;
  const isTerminalBranch = isLastVisible && !hasOverflow;
  const activityText = entry.progress?.activityText?.trim() ||
    entry.detail?.trim() ||
    entry.statusLabel;
  return {
    id: entry.id,
    treePrefix: isTerminalBranch ? "└─" : "├─",
    previewPrefix: isTerminalBranch ? "   " : "│  ",
    name: entry.name,
    bodyText: activityText,
    metricsText: formatMetrics(entry),
    previewLines: entry.progress?.previewLines.slice(0, MAX_PREVIEW_LINES) ?? [],
    tone: statusTone(entry.status),
  };
}

export function buildLocalAgentsStatusPanelModel(
  entries: LocalAgentEntry[],
  width: number,
  options: {
    focused?: boolean;
    leader?: LocalAgentsLeaderState;
  } = {},
): LocalAgentsStatusPanelModel | null {
  if (entries.length === 0) return null;

  const focused = options.focused === true;
  const visibleEntries = entries.slice(0, MAX_VISIBLE_LOCAL_AGENTS);
  const overflowCount = Math.max(0, entries.length - visibleEntries.length);
  const hasOverflow = overflowCount > 0;
  const leader = buildLeaderText(entries, options.leader, focused);
  const agents = visibleEntries.map((entry, index) =>
    buildAgentText(entry, index, visibleEntries.length, hasOverflow)
  );
  const previewRowCount = agents.reduce(
    (count, agent) => count + agent.previewLines.length,
    0,
  );
  const overflow = hasOverflow
    ? truncate(
      `└─ ${overflowCount} more agents · Ctrl+T manager`,
      Math.max(18, width),
    )
    : undefined;

  return {
    leader,
    agents,
    overflow,
    rowCount: 1 + agents.length + previewRowCount + (overflow ? 1 : 0),
  };
}

interface LocalAgentsStatusPanelProps {
  model: LocalAgentsStatusPanelModel;
  width: number;
}

export function LocalAgentsStatusPanel(
  { model, width }: LocalAgentsStatusPanelProps,
): React.ReactElement | null {
  const sc = useSemanticColors();
  const primaryWidth = Math.max(18, width);
  const previewWidth = Math.max(16, width - 2);

  return (
    <Box flexDirection="column" marginBottom={1}>
      <Text
        backgroundColor={model.leader.highlighted
          ? sc.shell.chipActive.background
          : undefined}
        color={model.leader.highlighted
          ? sc.shell.chipActive.foreground
          : sc.text.primary}
        bold
      >
        <Text dimColor={!model.leader.highlighted}>{`${model.leader.treePrefix} `}</Text>
        <Text color={model.leader.highlighted ? sc.shell.chipActive.foreground : sc.status.warning}>
          {model.leader.name}
        </Text>
        <Text color={model.leader.highlighted ? sc.shell.chipActive.foreground : sc.text.muted}>
          {`: ${truncate(model.leader.bodyText, primaryWidth)}`}
        </Text>
        {model.leader.metricsText && (
          <Text color={model.leader.highlighted ? sc.shell.chipActive.foreground : sc.text.muted}>
            {truncate(model.leader.metricsText, primaryWidth)}
          </Text>
        )}
        {model.leader.hintText && (
          <Text color={model.leader.highlighted ? sc.shell.chipActive.foreground : sc.text.muted}>
            {truncate(model.leader.hintText, primaryWidth)}
          </Text>
        )}
      </Text>

      {model.agents.map((row) => {
        const rowColor = toneColor(row.tone, sc);
        const mainText = truncate(
          `${row.name}: ${row.bodyText}${row.metricsText ?? ""}`,
          primaryWidth,
        );
        return (
          <Box key={row.id} flexDirection="column">
            <Text color={rowColor}>
              <Text color={sc.text.muted}>{`${row.treePrefix} `}</Text>
              {mainText}
            </Text>
            {row.previewLines.map((line) => (
              <Box key={`${row.id}:${line}`}>
                <Text color={sc.text.muted}>
                  {`${row.previewPrefix} ${truncate(line, previewWidth)}`}
                </Text>
              </Box>
            ))}
          </Box>
        );
      })}

      {model.overflow && <Text color={sc.text.muted}>{model.overflow}</Text>}
    </Box>
  );
}
