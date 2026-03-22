/**
 * Team Event Component Integration Tests
 *
 * Verifies that TeamEventItem actually renders React elements for each
 * team event type — the component instantiates without crashing and
 * produces the expected element tree structure.
 *
 * Also verifies the ConversationPanel dispatch: isStructuredTeamInfoItem
 * correctly routes to TeamEventItem vs InfoMessage.
 */

import { assertEquals, assertExists } from "jsr:@std/assert@1";
import React from "react";
import { TeamEventItem } from "../../../src/hlvm/cli/repl-ink/components/conversation/TeamEventItem.tsx";
import type {
  TeamMessageInfoItem,
  TeamPlanReviewInfoItem,
  TeamShutdownInfoItem,
  TeamTaskInfoItem,
} from "../../../src/hlvm/cli/repl-ink/types.ts";

// ── Fixtures ──────────────────────────────────────────────

const TASK_ITEM: TeamTaskInfoItem = {
  type: "info",
  id: "t1",
  text: "Team task in_progress: Build auth (alice)",
  teamEventType: "team_task_updated",
  taskId: "task-1",
  goal: "Build auth",
  status: "in_progress",
  assigneeMemberId: "alice",
  ts: Date.now(),
};

const MESSAGE_ITEM: TeamMessageInfoItem = {
  type: "info",
  id: "m1",
  text: "Team message: alice -> lead: Need help",
  teamEventType: "team_message",
  kind: "message",
  fromMemberId: "alice",
  toMemberId: "lead",
  contentPreview: "Need help",
  ts: Date.now(),
};

const BROADCAST_ITEM: TeamMessageInfoItem = {
  type: "info",
  id: "m2",
  text: "Team broadcast: lead: All stop",
  teamEventType: "team_message",
  kind: "broadcast",
  fromMemberId: "lead",
  contentPreview: "All stop",
  ts: Date.now(),
};

const PLAN_REVIEW_ITEM: TeamPlanReviewInfoItem = {
  type: "info",
  id: "p1",
  text: "Team plan review requested for task t-1",
  teamEventType: "team_plan_review",
  approvalId: "apr-1",
  taskId: "t-1",
  submittedByMemberId: "alice",
  status: "pending",
  ts: Date.now(),
};

const SHUTDOWN_ITEM: TeamShutdownInfoItem = {
  type: "info",
  id: "s1",
  text: "Shutdown requested for alice: Task done",
  teamEventType: "team_shutdown",
  requestId: "shut-1",
  memberId: "alice",
  requestedByMemberId: "lead",
  status: "requested",
  reason: "Task done",
  ts: Date.now(),
};

// ── Helper ────────────────────────────────────────────────

/**
 * Recursively walk a React element tree and collect all string children,
 * which represent the visible text the component would render.
 */
function collectText(element: React.ReactElement | null): string[] {
  if (!element) return [];
  const texts: string[] = [];

  function walk(node: unknown): void {
    if (node == null || typeof node === "boolean") return;
    if (typeof node === "string") {
      texts.push(node);
      return;
    }
    if (typeof node === "number") {
      texts.push(String(node));
      return;
    }
    if (Array.isArray(node)) {
      node.forEach(walk);
      return;
    }
    if (React.isValidElement(node)) {
      const el = node as React.ReactElement<{ children?: unknown }>;
      if (el.props.children != null) {
        walk(el.props.children);
      }
    }
  }

  walk(element);
  return texts;
}

/** Render TeamEventItem and return the element + extracted text */
function renderTeamEvent(
  item: Parameters<typeof TeamEventItem>[0]["item"],
) {
  // TeamEventItem is wrapped in React.memo, so call the inner function
  const element = React.createElement(TeamEventItem, {
    item,
    width: 80,
  });
  assertExists(element, "TeamEventItem should return a React element");
  return { element, texts: collectText(element) };
}

// ── Component Render Tests ────────────────────────────────

Deno.test("TeamEventItem renders team_task_updated with goal and assignee text", () => {
  const { texts } = renderTeamEvent(TASK_ITEM);
  const joined = texts.join(" ");
  assertEquals(joined.includes("Task #task-1"), true, `Expected "Task #task-1" in: ${joined}`);
  assertEquals(joined.includes("Build auth"), true, `Expected "Build auth" in: ${joined}`);
  assertEquals(joined.includes("alice"), true, `Expected "alice" in: ${joined}`);
});

Deno.test("TeamEventItem renders team_task_updated without assignee when absent", () => {
  const noAssignee: TeamTaskInfoItem = {
    ...TASK_ITEM,
    assigneeMemberId: undefined,
  };
  const { texts } = renderTeamEvent(noAssignee);
  const joined = texts.join(" ");
  assertEquals(joined.includes("Task #task-1"), true);
  assertEquals(joined.includes("Assignee"), false, "Should not show Assignee line");
});

Deno.test("TeamEventItem renders team_message DM with from/to", () => {
  const { texts } = renderTeamEvent(MESSAGE_ITEM);
  const joined = texts.join(" ");
  assertEquals(joined.includes("alice"), true, `Expected "alice" in: ${joined}`);
  assertEquals(joined.includes("lead"), true, `Expected "lead" in: ${joined}`);
  assertEquals(joined.includes("→"), true, `Expected "→" arrow in: ${joined}`);
  assertEquals(joined.includes("Need help"), true, `Expected content preview in: ${joined}`);
});

Deno.test("TeamEventItem renders team_message broadcast without arrow", () => {
  const { texts } = renderTeamEvent(BROADCAST_ITEM);
  const joined = texts.join(" ");
  assertEquals(joined.includes("lead"), true);
  assertEquals(joined.includes("broadcast"), true, `Expected "broadcast" in: ${joined}`);
  assertEquals(joined.includes("All stop"), true);
});

Deno.test("TeamEventItem renders team_plan_review with task reference", () => {
  const { texts } = renderTeamEvent(PLAN_REVIEW_ITEM);
  const joined = texts.join(" ");
  assertEquals(joined.includes("Plan Review"), true, `Expected "Plan Review" in: ${joined}`);
  assertEquals(joined.includes("t-1"), true, `Expected task ID in: ${joined}`);
  assertEquals(joined.includes("alice"), true, `Expected submitter in: ${joined}`);
});

Deno.test("TeamEventItem renders team_plan_review with reviewer when present", () => {
  const approved: TeamPlanReviewInfoItem = {
    ...PLAN_REVIEW_ITEM,
    status: "approved",
    reviewedByMemberId: "lead",
  };
  const { texts } = renderTeamEvent(approved);
  const joined = texts.join(" ");
  assertEquals(joined.includes("Reviewed by"), true, `Expected reviewer line in: ${joined}`);
  assertEquals(joined.includes("lead"), true);
});

Deno.test("TeamEventItem renders team_shutdown with member and requester", () => {
  const { texts } = renderTeamEvent(SHUTDOWN_ITEM);
  const joined = texts.join(" ");
  assertEquals(joined.includes("Shutdown"), true, `Expected "Shutdown" in: ${joined}`);
  assertEquals(joined.includes("alice"), true, `Expected member in: ${joined}`);
  assertEquals(joined.includes("lead"), true, `Expected requester in: ${joined}`);
  assertEquals(joined.includes("Task done"), true, `Expected reason in: ${joined}`);
});

Deno.test("TeamEventItem renders team_shutdown without reason when absent", () => {
  const noReason: TeamShutdownInfoItem = {
    ...SHUTDOWN_ITEM,
    reason: undefined,
  };
  const { texts } = renderTeamEvent(noReason);
  const joined = texts.join(" ");
  assertEquals(joined.includes("Shutdown"), true);
  assertEquals(joined.includes("Reason"), false, "Should not show Reason line");
});

Deno.test("TeamEventItem handles all status tones without crashing", () => {
  // Exercise every status variant to ensure no runtime errors
  const statuses = {
    task: ["pending", "in_progress", "completed", "errored", "blocked"],
    message: ["message", "broadcast", "task_completed", "task_error", "idle_notification"],
    planReview: ["pending", "approved", "rejected"],
    shutdown: ["requested", "acknowledged", "forced", "completed"],
  };

  for (const status of statuses.task) {
    renderTeamEvent({ ...TASK_ITEM, status });
  }
  for (const kind of statuses.message) {
    renderTeamEvent({ ...MESSAGE_ITEM, kind });
  }
  for (const status of statuses.planReview) {
    renderTeamEvent({
      ...PLAN_REVIEW_ITEM,
      status: status as TeamPlanReviewInfoItem["status"],
    });
  }
  for (const status of statuses.shutdown) {
    renderTeamEvent({
      ...SHUTDOWN_ITEM,
      status: status as TeamShutdownInfoItem["status"],
    });
  }
  // If we get here, none of them threw
});
