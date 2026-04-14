export type LocalAgentKind = "agent";
export type LocalAgentStatus =
  | "waiting"
  | "blocked"
  | "running"
  | "idle"
  | "completed"
  | "failed"
  | "cancelled";

export interface LocalAgentEntry {
  id: string;
  kind: LocalAgentKind;
  name: string;
  memberId?: string;
  taskId?: string;
  threadId?: string;
  childSessionId?: string;
  label: string;
  status: LocalAgentStatus;
  statusLabel: string;
  detail?: string;
  interruptible: boolean;
  foregroundable?: boolean;
  overlayTarget: "background-tasks";
  overlayItemId: string;
  progress?: LocalAgentProgress;
}

export interface LocalAgentProgress {
  activityText?: string;
  previewLines: string[];
  toolUseCount?: number;
  tokenCount?: number;
  durationMs?: number;
}

const LOCAL_AGENT_STATUS_ORDER: LocalAgentStatus[] = [
  "waiting",
  "blocked",
  "running",
  "idle",
  "failed",
  "completed",
  "cancelled",
];

/** O(1) priority lookup for status sorting (avoids indexOf per comparison) */
const LOCAL_AGENT_STATUS_PRIORITY: ReadonlyMap<string, number> = new Map(
  LOCAL_AGENT_STATUS_ORDER.map((v, i) => [v, i]),
);

const LOCAL_AGENT_STATUS_SUMMARY_LABEL: Record<LocalAgentStatus, string> = {
  waiting: "waiting",
  blocked: "blocked",
  running: "working",
  idle: "idle",
  completed: "done",
  failed: "failed",
  cancelled: "cancelled",
};

export function statusPriority(status: LocalAgentStatus): number {
  return LOCAL_AGENT_STATUS_PRIORITY.get(status) ?? LOCAL_AGENT_STATUS_ORDER.length;
}

export function summarizeLocalAgentFleet(entries: LocalAgentEntry[]): string {
  const counts: Record<LocalAgentStatus, number> = {
    waiting: 0,
    blocked: 0,
    running: 0,
    idle: 0,
    completed: 0,
    failed: 0,
    cancelled: 0,
  };

  for (const entry of entries) {
    counts[entry.status] = (counts[entry.status] ?? 0) + 1;
  }

  return LOCAL_AGENT_STATUS_ORDER
    .filter((status) => counts[status] > 0)
    .map((status) =>
      `${counts[status]} ${LOCAL_AGENT_STATUS_SUMMARY_LABEL[status]}`
    )
    .slice(0, 3)
    .join(" \u00B7 ");
}
