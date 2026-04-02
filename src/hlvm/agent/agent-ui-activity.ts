import type { AgentUIEvent } from "./orchestrator.ts";
import type { DelegateTranscriptEvent } from "./delegate-transcript.ts";

export function toDelegateTranscriptEvent(
  event: AgentUIEvent,
): DelegateTranscriptEvent | null {
  switch (event.type) {
    case "thinking":
    case "plan_phase_changed":
      return null;
    case "reasoning_update":
      return {
        type: "reasoning",
        iteration: event.iteration,
        summary: event.summary,
      };
    case "planning_update":
      return {
        type: "planning",
        iteration: event.iteration,
        summary: event.summary,
      };
    case "plan_created":
      return { type: "plan_created", stepCount: event.plan.steps.length };
    case "plan_step":
      return {
        type: "plan_step",
        stepId: event.stepId,
        index: event.index,
        completed: event.completed,
      };
    case "tool_start":
      return {
        type: "tool_start",
        name: event.name,
        argsSummary: event.argsSummary,
        toolIndex: event.toolIndex,
        toolTotal: event.toolTotal,
      };
    case "tool_progress":
      return {
        type: "tool_progress",
        name: event.name,
        argsSummary: event.argsSummary,
        message: event.message,
      };
    case "tool_end":
      return {
        type: "tool_end",
        name: event.name,
        success: event.success,
        content: event.content,
        summary: event.summary,
        durationMs: event.durationMs,
        argsSummary: event.argsSummary,
      };
    case "turn_stats":
      return {
        type: "turn_stats",
        iteration: event.iteration,
        toolCount: event.toolCount,
        durationMs: event.durationMs,
        inputTokens: event.inputTokens,
        outputTokens: event.outputTokens,
      };
    case "delegate_start":
    case "delegate_running":
    case "delegate_end":
    case "todo_updated":
    case "plan_review_required":
    case "plan_review_resolved":
    case "interaction_request":
    case "team_task_updated":
    case "team_message":
    case "team_member_activity":
    case "team_plan_review_required":
    case "team_plan_review_resolved":
    case "team_shutdown_requested":
    case "team_shutdown_resolved":
    case "memory_activity":
    case "batch_progress_updated":
      return null;
  }
  return null;
}
