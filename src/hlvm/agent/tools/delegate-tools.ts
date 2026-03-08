/**
 * Delegate orchestration tools.
 *
 * These are internal scheduler/control-plane tools for background delegates.
 */

import type { ToolMetadata } from "../registry.ts";
import {
  cancelThread,
  type DelegateThread,
  getAllThreads,
  getThread,
  sendThreadInput,
} from "../delegate-threads.ts";
import { applyChildChanges } from "../delegation.ts";

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
  };
  if (thread.filesModified?.length) {
    base.filesModified = thread.filesModified;
  }
  if (mergeResult) {
    if (mergeResult.applied.length > 0) {
      base.filesApplied = mergeResult.applied;
    }
    if (mergeResult.conflicts.length > 0) {
      base.conflicts = mergeResult.conflicts;
    }
  }
  if (thread.resultDiff && !mergeResult) {
    base.diff = thread.resultDiff;
  }
  return base;
}

/**
 * Auto-apply child workspace changes to parent workspace on completion.
 * Returns merge result or undefined if no merge needed.
 */
async function maybeApplyChildChanges(
  thread: DelegateThread,
  parentWorkspace?: string,
): Promise<{ applied: string[]; conflicts: string[] } | undefined> {
  if (
    !thread.workspacePath || !thread.filesModified?.length ||
    thread.status !== "completed" || !parentWorkspace
  ) {
    return undefined;
  }
  try {
    const result = await applyChildChanges(
      parentWorkspace,
      thread.workspacePath,
      thread.filesModified,
      thread.parentSnapshots,
    );
    // Cleanup workspace after successful apply
    await thread.workspaceCleanup?.();
    return result;
  } catch {
    return undefined;
  }
}

const waitAgent: ToolMetadata = {
  fn: async (args: unknown, workspace?: string) => {
    const record = (args && typeof args === "object")
      ? args as Record<string, unknown>
      : {};
    const threadId = typeof record.thread_id === "string"
      ? record.thread_id
      : undefined;
    const timeoutMs = typeof record.timeout_ms === "number"
      ? record.timeout_ms
      : undefined;

    if (threadId) {
      // Wait for specific thread
      const thread = getThread(threadId);
      if (!thread) {
        return { error: `No thread found with ID "${threadId}"` };
      }
      if (
        thread.status === "completed" || thread.status === "errored" ||
        thread.status === "cancelled"
      ) {
        const mergeResult = await maybeApplyChildChanges(thread, workspace);
        return formatThreadResult(thread, mergeResult);
      }
      // Await with optional timeout (cleanup timer to prevent leaks)
      let timeoutId: ReturnType<typeof setTimeout> | undefined;
      try {
        const result = timeoutMs
          ? await Promise.race([
            thread.promise,
            new Promise<never>((_, reject) => {
              timeoutId = setTimeout(
                () => reject(new Error("Timeout waiting for agent")),
                timeoutMs,
              );
            }),
          ])
          : await thread.promise;
        const mergeResult = await maybeApplyChildChanges(thread, workspace);
        return {
          ...formatThreadResult(thread, mergeResult),
          ...(typeof result === "object" && result !== null ? result : {}),
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return { ...formatThreadResult(thread), error: message };
      } finally {
        if (timeoutId !== undefined) clearTimeout(timeoutId);
      }
    }

    // No thread_id: await first completed thread (Promise.race)
    const threads = getAllThreads();
    const active = threads.filter(
      (t) => t.status === "queued" || t.status === "running",
    );
    if (active.length === 0) {
      // Check for any completed threads
      const finished = threads.filter(
        (t) =>
          t.status === "completed" || t.status === "errored" ||
          t.status === "cancelled",
      );
      if (finished.length > 0) {
        return formatThreadResult(finished[finished.length - 1]);
      }
      return { error: "No active or completed delegate threads" };
    }

    let raceTimeoutId: ReturnType<typeof setTimeout> | undefined;
    try {
      const promises = active.map((t) =>
        t.promise.then(() => t)
      );
      const racePromises = timeoutMs
        ? [
          ...promises,
          new Promise<never>((_, reject) => {
            raceTimeoutId = setTimeout(
              () => reject(new Error("Timeout waiting for agent")),
              timeoutMs,
            );
          }),
        ]
        : promises;
      const finished = await Promise.race(racePromises);
      return formatThreadResult(finished);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { error: message };
    } finally {
      if (raceTimeoutId !== undefined) clearTimeout(raceTimeoutId);
    }
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
  fn: async () => {
    const threads = getAllThreads();
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
      })),
    };
  },
  description:
    "Inspect background delegate scheduler state and thread status.",
  category: "meta",
  args: {},
  returns: {
    agents:
      "array - List of { threadId, nickname, agent, task, status, childSessionId }",
  },
  safetyLevel: "L0",
  safety: "Read-only observation of delegate scheduler state.",
};

const closeAgent: ToolMetadata = {
  fn: async (args: unknown) => {
    const record = (args && typeof args === "object")
      ? args as Record<string, unknown>
      : {};
    const threadId = typeof record.thread_id === "string"
      ? record.thread_id
      : "";
    if (!threadId) {
      return { success: false, message: "thread_id is required" };
    }
    const thread = getThread(threadId);
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
  fn: async (args: unknown) => {
    const record = (args && typeof args === "object")
      ? args as Record<string, unknown>
      : {};
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
    const sent = sendThreadInput(threadId, message);
    if (!sent) {
      const thread = getThread(threadId);
      if (!thread) {
        return {
          success: false,
          message: `No thread found with ID "${threadId}"`,
        };
      }
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

const resumeAgent: ToolMetadata = {
  fn: async (args: unknown) => {
    const record = (args && typeof args === "object")
      ? args as Record<string, unknown>
      : {};
    const threadId = typeof record.thread_id === "string"
      ? record.thread_id
      : "";
    const prompt = typeof record.prompt === "string" ? record.prompt : "";
    if (!threadId || !prompt) {
      return { success: false, message: "thread_id and prompt are required" };
    }
    const thread = getThread(threadId);
    if (!thread) {
      return {
        success: false,
        message: `No thread found with ID "${threadId}"`,
      };
    }
    if (!thread.childSessionId) {
      return {
        success: false,
        message:
          `Thread "${thread.nickname}" has no persisted session to resume`,
      };
    }
    if (
      thread.status !== "completed" && thread.status !== "errored"
    ) {
      return {
        success: false,
        message:
          `Thread "${thread.nickname}" is ${thread.status} — can only resume completed/errored threads`,
      };
    }
    return {
      success: true,
      childSessionId: thread.childSessionId,
      threadId,
      prompt,
      message:
        `Ready to resume session ${thread.childSessionId} with new prompt. Use delegate_agent with sessionId to continue.`,
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

const reportResult: ToolMetadata = {
  fn: async (args: unknown) => {
    const record = (args && typeof args === "object")
      ? args as Record<string, unknown>
      : {};
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
  send_input: sendInput,
  resume_agent: resumeAgent,
  report_result: reportResult,
};
