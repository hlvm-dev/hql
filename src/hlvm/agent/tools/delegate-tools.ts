/**
 * Delegate orchestration tools.
 *
 * These are internal scheduler/control-plane tools for background delegates.
 */

import { delay } from "@std/async";
import { getErrorMessage, isObjectValue } from "../../../common/utils.ts";
import { getAgentLogger } from "../logger.ts";
import type { ToolExecutionOptions, ToolMetadata } from "../registry.ts";
import {
  cancelThread,
  clearThreadWorkspace,
  type DelegateThread,
  getThreadForOwner,
  getThreadsForOwner,
  resolveResumableThread,
  sendThreadInput,
  takeQueuedCompletedThreadForOwner,
  updateThreadMerge,
} from "../delegate-threads.ts";
import { applyChildChanges } from "../delegation.ts";

const WAIT_POLL_INTERVAL_MS = 25;

/** DRY: safely parse tool args into a record (shared by all delegate tools). */
function parseToolArgs(args: unknown): Record<string, unknown> {
  return (args && typeof args === "object")
    ? args as Record<string, unknown>
    : {};
}

function shouldAutoApplyChildChanges(
  thread: DelegateThread,
  options?: ToolExecutionOptions,
): boolean {
  const policy = options?.teamRuntime?.getPolicy?.();
  if (!policy) return true;
  if (!policy.autoApplyCleanChanges) return false;
  if (!policy.reviewRequired) return true;
  const task = options?.teamRuntime?.getTaskByThread(thread.threadId);
  const reviewStatus = task?.artifacts && typeof task.artifacts.reviewStatus === "string"
    ? task.artifacts.reviewStatus
    : undefined;
  return reviewStatus === "approved";
}

function syncTeamTaskMergeState(
  thread: DelegateThread,
  mergeState: string,
  options?: ToolExecutionOptions,
): void {
  const task = options?.teamRuntime?.getTaskByThread(thread.threadId);
  if (!task) return;
  options?.teamRuntime?.updateTask(task.id, {
    artifacts: {
      ...(task.artifacts ?? {}),
      mergeState,
    },
  });
}

/** DRY: format a thread into the standard result shape. */
function formatThreadResult(
  thread: DelegateThread,
  mergeResult?: { applied: string[]; conflicts: string[] },
): Record<string, unknown> {
  const base: Record<string, unknown> = {
    threadId: thread.threadId,
    nickname: thread.nickname,
    agent: thread.agent,
    status: thread.status,
    result: thread.snapshot?.finalResponse,
    error: thread.snapshot?.error,
    mergeState: thread.mergeState ?? "none",
  };
  if (thread.workspaceKind) {
    base.workspaceKind = thread.workspaceKind;
  }
  if (thread.sandboxCapability) {
    base.sandboxCapability = thread.sandboxCapability;
  }
  if (thread.batchId) {
    base.batchId = thread.batchId;
  }
  if (thread.filesModified?.length) {
    base.filesModified = thread.filesModified;
  }
  const resolvedMerge = mergeResult ?? thread.mergeResult;
  if (resolvedMerge) {
    if (resolvedMerge.applied.length > 0) {
      base.filesApplied = resolvedMerge.applied;
    }
    if (resolvedMerge.conflicts.length > 0) {
      base.conflicts = resolvedMerge.conflicts;
    }
  }
  if (thread.resultDiff && !resolvedMerge) {
    base.diff = thread.resultDiff;
  }
  return base;
}

function isTerminalThread(thread: DelegateThread | undefined): thread is DelegateThread {
  return !!thread &&
    (thread.status === "completed" || thread.status === "errored" || thread.status === "cancelled");
}

function resolveDelegateOwnerId(
  options?: ToolExecutionOptions,
): string | undefined {
  return options?.delegateOwnerId;
}

function getScopedThread(
  threadId: string,
  options?: ToolExecutionOptions,
): DelegateThread | undefined {
  return getThreadForOwner(threadId, resolveDelegateOwnerId(options));
}

function getScopedThreads(options?: ToolExecutionOptions): DelegateThread[] {
  return getThreadsForOwner(resolveDelegateOwnerId(options));
}

function buildTimeoutResult(
  options?: ToolExecutionOptions,
  specificThread?: DelegateThread,
): Record<string, unknown> {
  const threads = getScopedThreads(options);
  const summary = threads.map((t) => ({
    id: t.threadId,
    agent: t.agent,
    status: t.status,
  }));
  const errored = threads.filter((t) => t.status === "errored");
  const running = threads.filter((t) =>
    t.status === "queued" || t.status === "running"
  );
  const hint = errored.length > 0 && running.length === 0
    ? "All delegates have errored. Use list_agents to inspect errors, then summarize available results for the user."
    : running.length > 0
    ? "Delegates are still running. You may call wait_agent once more, or use close_agent to cancel them and summarize partial results."
    : "No active delegates remain. Summarize available results for the user.";
  return {
    ...(specificThread ? formatThreadResult(specificThread) : {}),
    error: "Timeout waiting for agent",
    threads: summary,
    hint,
  };
}

async function buildWaitResult(
  thread: DelegateThread,
  workspace?: string,
  options?: ToolExecutionOptions,
): Promise<Record<string, unknown>> {
  const mergeResult = await maybeApplyChildChanges(thread, workspace, options);
  return {
    ...formatThreadResult(thread, mergeResult),
    ...(isObjectValue(thread.terminalResult) ? thread.terminalResult : {}),
  };
}

async function waitForSpecificThreadCompletion(
  threadId: string,
  options?: ToolExecutionOptions,
  timeoutMs?: number,
): Promise<DelegateThread | undefined> {
  const deadline = timeoutMs !== undefined ? Date.now() + timeoutMs : undefined;
  while (true) {
    const thread = getScopedThread(threadId, options);
    if (!thread) return undefined;
    if (isTerminalThread(thread)) return thread;
    if (deadline !== undefined && Date.now() >= deadline) return thread;
    const remaining = deadline === undefined ? WAIT_POLL_INTERVAL_MS : Math.max(0, deadline - Date.now());
    await delay(Math.min(WAIT_POLL_INTERVAL_MS, remaining));
  }
}

function getLatestTerminalThread(threads: DelegateThread[]): DelegateThread | undefined {
  let latest: DelegateThread | undefined;
  for (const thread of threads) {
    if (
      isTerminalThread(thread) &&
      (!latest || (thread.completedAt ?? 0) > (latest.completedAt ?? 0))
    ) {
      latest = thread;
    }
  }
  return latest;
}

async function waitForAnyThreadCompletionForOwner(
  options?: ToolExecutionOptions,
  timeoutMs?: number,
): Promise<DelegateThread | undefined> {
  const deadline = timeoutMs !== undefined ? Date.now() + timeoutMs : undefined;
  while (true) {
    const queued = takeQueuedCompletedThreadForOwner(resolveDelegateOwnerId(options));
    if (queued) return queued;
    const threads = getScopedThreads(options);
    const active = threads.filter((t) => t.status === "queued" || t.status === "running");
    if (active.length === 0) {
      return getLatestTerminalThread(threads);
    }
    if (deadline !== undefined && Date.now() >= deadline) return undefined;
    const remaining = deadline === undefined ? WAIT_POLL_INTERVAL_MS : Math.max(0, deadline - Date.now());
    await delay(Math.min(WAIT_POLL_INTERVAL_MS, remaining));
  }
}

/**
 * Auto-apply child workspace changes to parent workspace on completion.
 * Returns merge result or undefined if no merge needed.
 */
async function maybeApplyChildChanges(
  thread: DelegateThread,
  parentWorkspace?: string,
  options?: ToolExecutionOptions,
  force = false,
): Promise<{ applied: string[]; conflicts: string[] } | undefined> {
  if (
    thread.status !== "completed" || !parentWorkspace
  ) {
    return undefined;
  }
  if (
    thread.mergeState === "applied" || thread.mergeState === "conflicted" ||
    thread.mergeState === "discarded"
  ) {
    return thread.mergeResult;
  }
  if (!thread.workspacePath) {
    return thread.mergeResult;
  }
  if (!thread.filesModified?.length) {
    await thread.workspaceCleanup?.();
    clearThreadWorkspace(thread.threadId);
    return thread.mergeResult;
  }
  if (!force && !shouldAutoApplyChildChanges(thread, options)) {
    updateThreadMerge(thread.threadId, "pending", thread.mergeResult);
    syncTeamTaskMergeState(thread, "pending", options);
    return thread.mergeResult;
  }
  try {
    const result = await applyChildChanges(
      parentWorkspace,
      thread.workspacePath,
      thread.filesModified,
      thread.parentSnapshots,
    );
    if (result.conflicts.length > 0) {
      updateThreadMerge(thread.threadId, "conflicted", result);
      syncTeamTaskMergeState(thread, "conflicted", options);
      return result;
    }
    updateThreadMerge(thread.threadId, "applied", result);
    syncTeamTaskMergeState(thread, "applied", options);
    await thread.workspaceCleanup?.();
    clearThreadWorkspace(thread.threadId);
    return result;
  } catch (error) {
    getAgentLogger().warn(
      `Failed to apply child changes for thread "${thread.nickname}": ${getErrorMessage(error)}`,
    );
    return undefined;
  }
}

const waitAgent: ToolMetadata = {
  fn: async (
    args: unknown,
    workspace?: string,
    options?: ToolExecutionOptions,
  ) => {
    const record = parseToolArgs(args);
    const threadId = typeof record.thread_id === "string"
      ? record.thread_id
      : undefined;
    const timeoutMs = typeof record.timeout_ms === "number"
      ? record.timeout_ms
      : undefined;

    if (threadId) {
      const thread = getScopedThread(threadId, options);
      if (!thread) {
        return { error: `No thread found with ID "${threadId}"` };
      }
      if (isTerminalThread(thread)) {
        return await buildWaitResult(thread, workspace, options);
      }
      const completedThread = await waitForSpecificThreadCompletion(
        threadId,
        options,
        timeoutMs,
      );
      if (completedThread && isTerminalThread(completedThread)) {
        return await buildWaitResult(completedThread, workspace, options);
      }
      return buildTimeoutResult(options, thread);
    }

    const threads = getScopedThreads(options);
    const active = threads.filter(
      (t) => t.status === "queued" || t.status === "running",
    );
    if (active.length === 0) {
      const finished = getLatestTerminalThread(threads);
      if (finished) {
        return await buildWaitResult(finished, workspace, options);
      }
      return { error: "No active or completed delegate threads" };
    }

    const finished = await waitForAnyThreadCompletionForOwner(options, timeoutMs);
    if (finished) {
      return await buildWaitResult(finished, workspace, options);
    }
    return buildTimeoutResult(options);
  },
  description:
    "Await a background delegate result for ongoing orchestration.",
  category: "meta",
  args: {
    thread_id:
      "string (optional) - Thread ID to wait for. If omitted, waits for any thread to complete.",
    timeout_ms:
      "number (optional) - Maximum wait time in milliseconds. If omitted, waits indefinitely.",
  },
  returns: {
    threadId: "string",
    nickname: "string",
    agent: "string",
    status: "string",
    result: "string (optional)",
    error: "string (optional)",
  },
  safetyLevel: "L0",
  safety: "Read-only observation of delegate scheduler state.",
};

const listAgents: ToolMetadata = {
  fn: async (_args: unknown, _workspace?: string, options?: ToolExecutionOptions) => {
    const threads = getScopedThreads(options);
    if (threads.length === 0) {
      return { agents: [], message: "No delegate threads" };
    }
    return {
      agents: threads.map((t) => ({
        threadId: t.threadId,
        nickname: t.nickname,
        agent: t.agent,
        task: t.task,
        status: t.status,
        childSessionId: t.childSessionId,
        mergeState: t.mergeState ?? "none",
        batchId: t.batchId,
        workspaceKind: t.workspaceKind,
        sandboxCapability: t.sandboxCapability,
      })),
    };
  },
  description:
    "Inspect background delegate scheduler state and thread status.",
  category: "meta",
  args: {},
  returns: {
    agents:
      "array - List of { threadId, nickname, agent, task, status, childSessionId, mergeState, batchId, workspaceKind, sandboxCapability }",
  },
  safetyLevel: "L0",
  safety: "Read-only observation of delegate scheduler state.",
};

const closeAgent: ToolMetadata = {
  fn: async (args: unknown, _workspace?: string, options?: ToolExecutionOptions) => {
    const record = parseToolArgs(args);
    const threadId = typeof record.thread_id === "string"
      ? record.thread_id
      : "";
    if (!threadId) {
      return { success: false, message: "thread_id is required" };
    }
    const thread = getScopedThread(threadId, options);
    if (!thread) {
      return {
        success: false,
        message: `No thread found with ID "${threadId}"`,
      };
    }
    const cancelled = cancelThread(threadId);
    if (!cancelled) {
      return {
        success: false,
        message:
          `Thread "${thread.nickname}" (${threadId}) is already ${thread.status}`,
      };
    }
    return {
      success: true,
      message:
        `Thread "${thread.nickname}" (${threadId}) cancelled successfully`,
    };
  },
  description: "Cancel a background delegate that is no longer needed.",
  category: "meta",
  args: {
    thread_id: "string - Thread ID of the delegate to cancel",
  },
  returns: {
    success: "boolean",
    message: "string",
  },
  safetyLevel: "L1",
  safety: "Cancels active delegated work. Mild mutation.",
};

const sendInput: ToolMetadata = {
  fn: async (args: unknown, _workspace?: string, options?: ToolExecutionOptions) => {
    const record = parseToolArgs(args);
    const threadId = typeof record.thread_id === "string"
      ? record.thread_id
      : "";
    const message = typeof record.message === "string"
      ? record.message
      : "";
    if (!threadId || !message) {
      return {
        success: false,
        message: "thread_id and message are required",
      };
    }
    const thread = getScopedThread(threadId, options);
    if (!thread) {
      return {
        success: false,
        message: `No thread found with ID "${threadId}"`,
      };
    }
    const sent = sendThreadInput(threadId, message);
    if (!sent) {
      return {
        success: false,
        message:
          `Thread "${thread.nickname}" (${threadId}) is ${thread.status} — cannot send input`,
      };
    }
    return {
      success: true,
      message:
        `Message queued for delivery at next iteration boundary of thread "${threadId}"`,
    };
  },
  description:
    "Send a steering message to a running background agent. Delivered at the next ReAct iteration boundary.",
  category: "meta",
  args: {
    thread_id: "string - Thread ID of the running delegate",
    message: "string - Message to send to the agent",
  },
  returns: {
    success: "boolean",
    message: "string",
  },
  safetyLevel: "L0",
  safety: "Queues a non-interruptible steering message for a delegate.",
};

const interruptAgent: ToolMetadata = {
  fn: async (args: unknown, _workspace?: string, options?: ToolExecutionOptions) => {
    const record = parseToolArgs(args);
    const threadId = typeof record.thread_id === "string"
      ? record.thread_id
      : "";
    const message = typeof record.message === "string"
      ? record.message
      : "";
    if (!threadId || !message) {
      return {
        success: false,
        message: "thread_id and message are required",
      };
    }
    const thread = getScopedThread(threadId, options);
    if (!thread) {
      return {
        success: false,
        message: `No thread found with ID "${threadId}"`,
      };
    }
    if (thread.status !== "queued" && thread.status !== "running") {
      return {
        success: false,
        message: `Thread "${thread.nickname}" is ${thread.status} — only active threads can be interrupted`,
      };
    }
    return {
      success: true,
      threadId,
      message:
        `Interrupt request validated for thread "${threadId}". Execution is handled by the orchestrator.`,
    };
  },
  description:
    "Interrupt an active delegate turn and resume it from persisted history with a new instruction.",
  category: "meta",
  args: {
    thread_id: "string - Thread ID of the running delegate",
    message: "string - New instruction to run after interruption",
  },
  returns: {
    success: "boolean",
    threadId: "string",
    message: "string",
  },
  safetyLevel: "L1",
  safety: "Interrupts active delegated work before resuming it.",
};

const resumeAgent: ToolMetadata = {
  fn: async (args: unknown, _workspace?: string, options?: ToolExecutionOptions) => {
    const record = parseToolArgs(args);
    const threadId = typeof record.thread_id === "string"
      ? record.thread_id
      : "";
    const prompt = typeof record.prompt === "string" ? record.prompt : "";
    if (!threadId || !prompt) {
      return { success: false, message: "thread_id and prompt are required" };
    }
    const { thread, error } = resolveResumableThread(
      threadId,
      resolveDelegateOwnerId(options),
    );
    if (!thread || error) {
      return {
        success: false,
        message: error ?? "Unable to resume delegate",
      };
    }
    return {
      success: true,
      childSessionId: thread.childSessionId,
      threadId,
      prompt,
      message:
        `Resume request validated for session ${thread.childSessionId}.`,
    };
  },
  description:
    "Resume a completed background agent by rehydrating its persisted session transcript and running a new ReAct loop with the given prompt.",
  category: "meta",
  args: {
    thread_id:
      "string - Thread ID of the completed delegate to resume",
    prompt: "string - New prompt/instructions for the resumed agent",
  },
  returns: {
    agent: "string",
    result: "string",
    resumed: "boolean",
    childSessionId: "string",
  },
  safetyLevel: "L1",
  safety: "Read-only session lookup. Actual resume happens via delegation.",
};

const discardAgentChanges: ToolMetadata = {
  fn: async (
    args: unknown,
    _workspace: string,
    options?: ToolExecutionOptions,
  ) => {
    const record = parseToolArgs(args);
    const threadId = typeof record.thread_id === "string"
      ? record.thread_id
      : "";
    if (!threadId) {
      return { success: false, message: "thread_id is required" };
    }
    const thread = getScopedThread(threadId, options);
    if (!thread) {
      return {
        success: false,
        message: `No thread found with ID "${threadId}"`,
      };
    }
    if (!thread.workspacePath && thread.mergeState !== "conflicted") {
      return {
        success: false,
        message: `Thread "${thread.nickname}" has no pending child changes to discard`,
      };
    }
    await thread.workspaceCleanup?.();
    clearThreadWorkspace(threadId);
    updateThreadMerge(threadId, "discarded", thread.mergeResult ?? {
      applied: [],
      conflicts: thread.filesModified ?? [],
    });
    syncTeamTaskMergeState(thread, "discarded", options);
    return {
      success: true,
      message: `Discarded child changes for thread "${thread.nickname}" (${threadId})`,
    };
  },
  description: "Discard a child workspace after conflicts or unwanted delegated changes.",
  category: "meta",
  args: {
    thread_id: "string - Thread ID of the delegate whose child changes should be discarded",
  },
  returns: {
    success: "boolean",
    message: "string",
  },
  safetyLevel: "L1",
  safety: "Deletes unmerged child workspace changes for a completed delegate.",
};

const applyAgentChanges: ToolMetadata = {
  fn: async (
    args: unknown,
    workspace: string,
    options?: ToolExecutionOptions,
  ) => {
    const record = parseToolArgs(args);
    const threadId = typeof record.thread_id === "string"
      ? record.thread_id
      : "";
    if (!threadId) {
      return { success: false, message: "thread_id is required" };
    }
    const thread = getScopedThread(threadId, options);
    if (!thread) {
      return {
        success: false,
        message: `No thread found with ID "${threadId}"`,
      };
    }
    const mergeResult = await maybeApplyChildChanges(thread, workspace, options, true);
    if (!mergeResult) {
      return {
        success: false,
        message: `Thread "${thread.nickname}" has no pending child changes to apply`,
      };
    }
    return {
      success: mergeResult.conflicts.length === 0,
      threadId,
      mergeState: thread.mergeState ?? "none",
      applied: mergeResult.applied,
      conflicts: mergeResult.conflicts,
    };
  },
  description:
    "Apply pending child workspace changes for a completed delegate after review or policy gating.",
  category: "meta",
  args: {
    thread_id: "string - Thread ID of the completed delegate whose changes should be applied",
  },
  returns: {
    success: "boolean",
    threadId: "string",
    mergeState: "string",
    applied: "array",
    conflicts: "array",
  },
  safetyLevel: "L1",
  safety: "Mutates the parent workspace by applying delegated changes.",
};

const reportResult: ToolMetadata = {
  fn: async (args: unknown) => {
    const record = parseToolArgs(args);
    const summary = typeof record.summary === "string" ? record.summary : "";
    if (!summary) {
      return { success: false, message: "summary is required" };
    }
    // Structured result is returned as-is — the delegation framework
    // captures it from the child's final response/tool output
    return {
      success: true,
      summary,
      data: record.data ?? undefined,
      files_modified: Array.isArray(record.files_modified)
        ? record.files_modified
        : undefined,
    };
  },
  description:
    "Report a structured result to the parent agent. Use this to provide a clear summary and optional structured data when completing a delegated task.",
  category: "meta",
  args: {
    summary: "string - Concise summary of the work completed",
    data: "object (optional) - Structured result data",
    files_modified:
      "array (optional) - List of file paths modified during this task",
  },
  returns: {
    success: "boolean",
    summary: "string",
    data: "object (optional)",
    files_modified: "array (optional)",
  },
  safetyLevel: "L0",
  safety: "Passive result reporting to parent agent.",
};

export const DELEGATE_TOOLS: Record<string, ToolMetadata> = {
  wait_agent: waitAgent,
  list_agents: listAgents,
  close_agent: closeAgent,
  apply_agent_changes: applyAgentChanges,
  discard_agent_changes: discardAgentChanges,
  send_input: sendInput,
  interrupt_agent: interruptAgent,
  resume_agent: resumeAgent,
  report_result: reportResult,
};
