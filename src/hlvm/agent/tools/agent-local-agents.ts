/**
 * Agent Local Agents Bridge
 *
 * Converts background agents from agent-tool.ts into LocalAgentEntry
 * for rendering in HLVM's existing BackgroundTasksOverlay.
 *
 * HLVM already has a full-featured task manager overlay with:
 * - Status icons (○ pending, ● running, ✓ completed)
 * - Navigation (↑↓ select, Enter view, k interrupt)
 * - Detail view with scrolling
 * - Local agent section with progress
 *
 * We just need to feed our agents into it.
 */

import type { LocalAgentEntry, LocalAgentStatus } from "../../cli/repl-ink/utils/local-agents.ts";
import { getAllBackgroundAgents, cancelBackgroundAgent } from "./agent-tool.ts";
import type { BackgroundAgent } from "./agent-types.ts";

/**
 * Convert a BackgroundAgent to a LocalAgentEntry for TUI rendering.
 * Maps agent status to HLVM's existing status display system.
 */
function toLocalAgentEntry(agent: BackgroundAgent): LocalAgentEntry {
  const statusMap: Record<BackgroundAgent["status"], LocalAgentStatus> = {
    running: "running",
    completed: "completed",
    errored: "failed",
  };

  const statusLabelMap: Record<BackgroundAgent["status"], string> = {
    running: "working",
    completed: "done",
    errored: agent.error ?? "failed",
  };

  return {
    id: agent.agentId,
    kind: "agent",
    name: agent.agentType,
    label: agent.description,
    status: statusMap[agent.status],
    statusLabel: statusLabelMap[agent.status],
    interruptible: agent.status === "running",
    overlayTarget: "background-tasks",
    overlayItemId: agent.agentId,
    progress: {
      toolUseCount: agent.result?.totalToolUseCount,
      durationMs: agent.status === "running"
        ? Date.now() - agent.startTime
        : agent.result?.totalDurationMs,
      previewLines: agent.result
        ? [agent.result.content.slice(0, 200)]
        : [],
    },
  };
}

/**
 * Get all background agents as LocalAgentEntry array.
 * Ready to pass directly to BackgroundTasksOverlay's localAgents prop.
 */
export function getBackgroundAgentEntries(): LocalAgentEntry[] {
  return getAllBackgroundAgents().map(toLocalAgentEntry);
}

/**
 * Cancel a background agent by ID.
 * Returns true if cancelled, false if not found or already completed.
 */
export { cancelBackgroundAgent };

// Register globally for TUI access (avoids circular import through React components)
// deno-lint-ignore no-explicit-any
(globalThis as any).__hlvmAgentLocalAgents = { getBackgroundAgentEntries };
