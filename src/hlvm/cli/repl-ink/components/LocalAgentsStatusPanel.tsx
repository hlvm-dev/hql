import React from "react";
import { Box, Text } from "ink";
import { truncate } from "../../../../common/utils.ts";
import { useSemanticColors } from "../../theme/index.ts";
import { useConversationSpinnerFrame } from "../hooks/useConversationMotion.ts";
import { formatDurationMs } from "../utils/formatting.ts";
import { type LocalAgentEntry, statusPriority } from "../utils/local-agents.ts";

const MAX_VISIBLE_LOCAL_AGENTS = 4;
const MAX_PREVIEW_LINES = 3;
const LOCAL_AGENT_SELECT_HINT = "↓ to manage";

type AgentRowTone = "active" | "warning" | "success" | "error" | "muted";

function isFinishedStatus(status: LocalAgentEntry["status"]): boolean {
  return status === "completed" || status === "failed" || status === "cancelled";
}

export interface LocalAgentsLeaderState {
  activityText?: string;
  idleText?: string;
  tokenCount?: number;
}

interface LocalAgentsAgentRow {
  id: string;
  treePrefix: string;
  statusPrefix: string;
  previewPrefix: string;
  name: string;
  statusText: string;
  metricsText?: string;
  previewLines: string[];
  tone: AgentRowTone;
}

export interface LocalAgentsCompactFooterModel {
  text: string;
  hintText?: string;
  highlighted: boolean;
  hasActiveAgents: boolean;
  rowCount: number;
}

interface BackgroundStatusFooterOptions {
  focused?: boolean;
  leader?: LocalAgentsLeaderState;
  activeTaskCount?: number;
  recentActiveTaskLabel?: string;
}

export interface LocalAgentsManagerPanelModel {
  summaryText: string;
  summaryHintText?: string;
  hasActiveAgents: boolean;
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

function formatLocalAgentCount(entries: LocalAgentEntry[]): string {
  const totalCount = entries.length;
  const activeCount = entries.filter((entry) => !isFinishedStatus(entry.status))
    .length;
  if (activeCount === 0) {
    return `${totalCount} local agent${totalCount === 1 ? "" : "s"} finished`;
  }
  if (activeCount === totalCount) {
    return `${totalCount} local agent${totalCount === 1 ? "" : "s"}`;
  }
  return `${totalCount} local agent${totalCount === 1 ? "" : "s"} · ${activeCount} active`;
}

function buildManagerSummary(
  entries: LocalAgentEntry[],
  focused: boolean,
): { text: string; hintText?: string } {
  const activeCount = entries.filter((entry) => !isFinishedStatus(entry.status))
    .length;
  return {
    text: formatLocalAgentCount(entries),
    hintText: focused
      ? activeCount === 0
        ? " · Enter to view results · Esc back"
        : " · Enter to view tasks · Esc back"
      : ` · ${LOCAL_AGENT_SELECT_HINT}`,
  };
}

function buildAgentText(
  entry: LocalAgentEntry,
  index: number,
  visibleCount: number,
  hasOverflow: boolean,
  showPreviewLines: boolean,
): LocalAgentsAgentRow {
  const isLastVisible = index === visibleCount - 1;
  const isTerminalBranch = isLastVisible && !hasOverflow;
  const activityText = entry.progress?.activityText?.trim() ||
    entry.detail?.trim() ||
    (entry.status === "completed" ? "" : entry.statusLabel);
  return {
    id: entry.id,
    treePrefix: isTerminalBranch ? "└─" : "├─",
    statusPrefix: isTerminalBranch ? "   ⎿  " : "│  ⎿  ",
    previewPrefix: isTerminalBranch ? "      " : "│     ",
    name: entry.name,
    statusText: activityText,
    metricsText: formatMetrics(entry),
    previewLines: showPreviewLines
      ? entry.progress?.previewLines.slice(0, MAX_PREVIEW_LINES) ?? []
      : [],
    tone: statusTone(entry.status),
  };
}

export function buildLocalAgentsCompactFooterModel(
  entries: LocalAgentEntry[],
  width: number,
  options: {
    focused?: boolean;
    leader?: LocalAgentsLeaderState;
  } = {},
): LocalAgentsCompactFooterModel | null {
  if (entries.length === 0) return null;
  const highlighted = options.focused === true;
  const hintText = highlighted
    ? " · Enter to view tasks · Esc back"
    : ` · ${LOCAL_AGENT_SELECT_HINT}`;
  const text = truncate(
    formatLocalAgentCount(entries),
    Math.max(18, width),
  );
  return {
    text,
    hintText,
    highlighted,
    hasActiveAgents: entries.some((entry) => !isFinishedStatus(entry.status)),
    rowCount: 1,
  };
}

export function buildBackgroundStatusFooterModel(
  entries: LocalAgentEntry[],
  width: number,
  options: BackgroundStatusFooterOptions = {},
): LocalAgentsCompactFooterModel | null {
  if (entries.length > 0) {
    return buildLocalAgentsCompactFooterModel(entries, width, {
      focused: options.focused,
      leader: options.leader,
    });
  }

  const activeTaskCount = Math.max(0, options.activeTaskCount ?? 0);
  if (activeTaskCount === 0) return null;

  const countText = activeTaskCount === 1
    ? "1 task running"
    : `${activeTaskCount} tasks running`;
  const taskLabel = options.recentActiveTaskLabel?.trim();
  const text = truncate(
    taskLabel ? `tasks · ${countText} · ${taskLabel}` : `tasks · ${countText}`,
    Math.max(18, width),
  );

  return {
    text,
    hintText: " · Ctrl+T manager",
    highlighted: false,
    hasActiveAgents: true,
    rowCount: 1,
  };
}

export function buildLocalAgentsManagerModel(
  entries: LocalAgentEntry[],
  width: number,
  options: {
    focused?: boolean;
    leader?: LocalAgentsLeaderState;
  } = {},
): LocalAgentsManagerPanelModel | null {
  if (entries.length === 0) return null;

  const focused = options.focused === true;
  const showPreviewLines = focused;
  const sortedEntries = [...entries].sort((a, b) =>
    statusPriority(a.status) - statusPriority(b.status)
  );
  const visibleEntries = sortedEntries.slice(0, MAX_VISIBLE_LOCAL_AGENTS);
  const overflowCount = Math.max(0, entries.length - visibleEntries.length);
  const hasOverflow = overflowCount > 0;
  const summary = buildManagerSummary(entries, focused);
  const agents = visibleEntries.map((entry, index) =>
    buildAgentText(
      entry,
      index,
      visibleEntries.length,
      hasOverflow,
      showPreviewLines,
    )
  );
  const previewRowCount = agents.reduce(
    (count, agent) => count + agent.previewLines.length,
    0,
  );
  const overflow = hasOverflow
    ? truncate(
      `└─ ${overflowCount} more agents · ${LOCAL_AGENT_SELECT_HINT}`,
      Math.max(18, width),
    )
    : undefined;

  return {
    summaryText: summary.text,
    summaryHintText: summary.hintText,
    hasActiveAgents: entries.some((entry) => !isFinishedStatus(entry.status)),
    agents,
    overflow,
    rowCount: 1 + (agents.length * 2) + previewRowCount + (overflow ? 1 : 0),
  };
}

interface LocalAgentsStatusPanelProps {
  model: LocalAgentsCompactFooterModel;
  width: number;
}

export function LocalAgentsCompactFooter(
  { model, width }: LocalAgentsStatusPanelProps,
): React.ReactElement | null {
  const sc = useSemanticColors();
  const spinner = useConversationSpinnerFrame(model.hasActiveAgents);
  const contentWidth = Math.max(18, width);

  return (
    <Box flexDirection="column" marginBottom={1}>
      <Text
        backgroundColor={model.highlighted
          ? sc.shell.chipActive.background
          : undefined}
        color={model.highlighted
          ? sc.shell.chipActive.foreground
          : sc.text.primary}
        bold
      >
        <Text color={model.highlighted ? sc.shell.chipActive.foreground : sc.status.warning}>
          {`${spinner ?? "●"} `}
        </Text>
        <Text color={model.highlighted ? sc.shell.chipActive.foreground : sc.status.warning}>
          {truncate(model.text, contentWidth)}
        </Text>
        {model.hintText && (
          <Text color={model.highlighted ? sc.shell.chipActive.foreground : sc.text.muted}>
            {truncate(model.hintText, contentWidth)}
          </Text>
        )}
      </Text>
    </Box>
  );
}

interface LocalAgentsManagerPanelProps {
  model: LocalAgentsManagerPanelModel;
  width: number;
}

export function LocalAgentsManagerPanel(
  { model, width }: LocalAgentsManagerPanelProps,
): React.ReactElement | null {
  const sc = useSemanticColors();
  const spinner = useConversationSpinnerFrame(model.hasActiveAgents);
  const primaryWidth = Math.max(18, width);
  const previewWidth = Math.max(16, width - 6);

  return (
    <Box flexDirection="column" marginBottom={1}>
      <Text bold>
        <Text color={model.hasActiveAgents ? sc.footer.status.active : sc.status.success}>
          {`${spinner ?? "●"} `}
        </Text>
        <Text color={sc.text.primary}>
          {truncate(model.summaryText, primaryWidth)}
        </Text>
        {model.summaryHintText && (
          <Text color={sc.text.muted}>
            {truncate(model.summaryHintText, primaryWidth)}
          </Text>
        )}
      </Text>
      {model.agents.map((row) => {
        const rowColor = row.tone === "error"
          ? toneColor(row.tone, sc)
          : sc.text.primary;
        const statusText = truncate(row.statusText, previewWidth);
        return (
          <Box key={row.id} flexDirection="column">
            <Text bold>
              <Text color={sc.text.muted}>{`${row.treePrefix} `}</Text>
              <Text color={rowColor}>{row.name}</Text>
              {row.metricsText && (
                <Text color={sc.text.muted}>{row.metricsText}</Text>
              )}
            </Text>
            {statusText && (
              <Text>
                <Text color={sc.text.muted}>{row.statusPrefix}</Text>
                <Text color={row.tone === "error" ? toneColor(row.tone, sc) : sc.text.muted}>
                  {statusText}
                </Text>
              </Text>
            )}
            {row.previewLines.map((line) => (
              <Text key={`${row.id}:${line}`} color={sc.text.muted}>
                {`${row.previewPrefix}${truncate(line, previewWidth)}`}
              </Text>
            ))}
          </Box>
        );
      })}

      {model.overflow && <Text color={sc.text.muted}>{model.overflow}</Text>}
    </Box>
  );
}
