import { LRUCache } from "../../common/lru-cache.ts";
import type { AgentExecutionMode } from "./execution-mode.ts";
import type { AgentSession } from "./session.ts";
import type { RuntimeMode } from "./runtime-mode.ts";

const MAX_REPL_LIVE_SESSIONS = 8;

export interface ReplLiveAgentSessionEntry {
  session: AgentSession;
  lastSessionVersion: number;
  model: string;
  querySource?: string;
  runtimeMode: RuntimeMode;
  permissionMode: AgentExecutionMode;
  toolAllowlist?: string[];
  toolDenylist?: string[];
}

export interface ResolveReplLiveAgentSessionOptions {
  sessionId: string;
  expectedSessionVersion?: number;
  model: string;
  querySource?: string;
  runtimeMode: RuntimeMode;
  permissionMode: AgentExecutionMode;
  toolAllowlist?: string[];
  toolDenylist?: string[];
}

export interface ResolveReplLiveAgentSessionResult {
  entry?: ReplLiveAgentSessionEntry;
  hotSessionReuse: boolean;
  invalidationReason?: string;
}

function normalizeToolList(list?: readonly string[]): string[] | undefined {
  if (!list?.length) {
    return undefined;
  }
  return [...new Set(list)].sort();
}

function toolListsMatch(
  left?: readonly string[],
  right?: readonly string[],
): boolean {
  const normalizedLeft = normalizeToolList(left);
  const normalizedRight = normalizeToolList(right);
  if (!normalizedLeft && !normalizedRight) {
    return true;
  }
  if (!normalizedLeft || !normalizedRight) {
    return false;
  }
  if (normalizedLeft.length !== normalizedRight.length) {
    return false;
  }
  return normalizedLeft.every((value, index) => value === normalizedRight[index]);
}

const replLiveSessions = new LRUCache<string, ReplLiveAgentSessionEntry>(
  MAX_REPL_LIVE_SESSIONS,
  (_sessionId, entry) => {
    void entry.session.dispose().catch(() => {});
  },
);

export function getReplLiveAgentSession(
  sessionId: string,
): ReplLiveAgentSessionEntry | undefined {
  return replLiveSessions.get(sessionId);
}

export function setReplLiveAgentSession(
  sessionId: string,
  entry: ReplLiveAgentSessionEntry,
): void {
  replLiveSessions.set(sessionId, {
    ...entry,
    toolAllowlist: normalizeToolList(entry.toolAllowlist),
    toolDenylist: normalizeToolList(entry.toolDenylist),
  });
}

export function invalidateReplLiveAgentSession(
  sessionId: string,
): void {
  replLiveSessions.delete(sessionId);
}

export async function disposeAllReplLiveAgentSessions(): Promise<void> {
  const entries = [...replLiveSessions.values()];
  replLiveSessions.clear();
  await Promise.allSettled(entries.map((entry) => entry.session.dispose()));
}

export function resolveReplLiveAgentSession(
  options: ResolveReplLiveAgentSessionOptions,
): ResolveReplLiveAgentSessionResult {
  const entry = getReplLiveAgentSession(options.sessionId);
  if (!entry) {
    return { hotSessionReuse: false };
  }
  if (
    options.expectedSessionVersion !== undefined &&
    entry.lastSessionVersion !== options.expectedSessionVersion
  ) {
    invalidateReplLiveAgentSession(options.sessionId);
    return {
      hotSessionReuse: false,
      invalidationReason: "session_version_mismatch",
    };
  }
  if (entry.model !== options.model) {
    invalidateReplLiveAgentSession(options.sessionId);
    return { hotSessionReuse: false, invalidationReason: "model_changed" };
  }
  if (entry.querySource !== options.querySource) {
    invalidateReplLiveAgentSession(options.sessionId);
    return {
      hotSessionReuse: false,
      invalidationReason: "query_source_changed",
    };
  }
  if (entry.runtimeMode !== options.runtimeMode) {
    invalidateReplLiveAgentSession(options.sessionId);
    return {
      hotSessionReuse: false,
      invalidationReason: "runtime_mode_changed",
    };
  }
  if (entry.permissionMode !== options.permissionMode) {
    invalidateReplLiveAgentSession(options.sessionId);
    return {
      hotSessionReuse: false,
      invalidationReason: "permission_mode_changed",
    };
  }
  if (!toolListsMatch(entry.toolAllowlist, options.toolAllowlist)) {
    invalidateReplLiveAgentSession(options.sessionId);
    return {
      hotSessionReuse: false,
      invalidationReason: "tool_allowlist_changed",
    };
  }
  if (!toolListsMatch(entry.toolDenylist, options.toolDenylist)) {
    invalidateReplLiveAgentSession(options.sessionId);
    return {
      hotSessionReuse: false,
      invalidationReason: "tool_denylist_changed",
    };
  }
  return { entry, hotSessionReuse: true };
}
