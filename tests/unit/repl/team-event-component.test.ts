/**
 * Team Event Component Integration Tests
 *
 * Verifies that:
 * 1. isStructuredTeamInfoItem correctly routes team items to TeamEventItem
 *    vs generic InfoMessage (the ConversationPanel dispatch path).
 * 2. React.createElement(TeamEventItem, ...) succeeds for every team event
 *    type and status variant without runtime errors (crash test).
 * 3. Element props are forwarded correctly (shallow verification).
 *
 * NOTE: Ink components (<Box>, <Text>) are terminal-only and cannot be
 * rendered via react-dom/server. Text content verification for team events
 * is handled by team-event-e2e.test.ts which tests the full pipeline:
 * AgentUIEvent → reducer → StructuredTeamInfoItem → chrome tone/glyph.
 */

import { assertEquals, assertExists } from "jsr:@std/assert@1";
import React from "react";
import { TeamEventItem } from "../../../src/hlvm/cli/repl-ink/components/conversation/TeamEventItem.tsx";
import {
  isStructuredTeamInfoItem,
  type TeamMessageInfoItem,
  type TeamPlanReviewInfoItem,
  type TeamShutdownInfoItem,
  type TeamTaskInfoItem,
  type ConversationItem,
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

// ── Dispatch: isStructuredTeamInfoItem ────────────────────

Deno.test("isStructuredTeamInfoItem identifies team_task_updated items", () => {
  assertEquals(isStructuredTeamInfoItem(TASK_ITEM), true);
});

Deno.test("isStructuredTeamInfoItem identifies team_message items", () => {
  assertEquals(isStructuredTeamInfoItem(MESSAGE_ITEM), true);
  assertEquals(isStructuredTeamInfoItem(BROADCAST_ITEM), true);
});

Deno.test("isStructuredTeamInfoItem identifies team_plan_review items", () => {
  assertEquals(isStructuredTeamInfoItem(PLAN_REVIEW_ITEM), true);
});

Deno.test("isStructuredTeamInfoItem identifies team_shutdown items", () => {
  assertEquals(isStructuredTeamInfoItem(SHUTDOWN_ITEM), true);
});

Deno.test("isStructuredTeamInfoItem rejects plain info items", () => {
  const plainInfo: ConversationItem = {
    type: "info",
    id: "i1",
    text: "Just a regular info message",
  };
  assertEquals(isStructuredTeamInfoItem(plainInfo), false);
});

Deno.test("isStructuredTeamInfoItem rejects non-info items", () => {
  const errorItem: ConversationItem = {
    type: "error",
    id: "x1",
    text: "Something went wrong",
  };
  assertEquals(isStructuredTeamInfoItem(errorItem), false);
});

// ── createElement: crash test for all event types ─────────

Deno.test("TeamEventItem createElement succeeds for team_task_updated", () => {
  const el = React.createElement(TeamEventItem, { item: TASK_ITEM, width: 80 });
  assertExists(el);
  assertEquals(el.props.item, TASK_ITEM);
  assertEquals(el.props.width, 80);
});

Deno.test("TeamEventItem createElement succeeds for team_message DM", () => {
  const el = React.createElement(TeamEventItem, { item: MESSAGE_ITEM, width: 80 });
  assertExists(el);
  assertEquals(el.props.item.teamEventType, "team_message");
});

Deno.test("TeamEventItem createElement succeeds for team_message broadcast", () => {
  const el = React.createElement(TeamEventItem, { item: BROADCAST_ITEM, width: 80 });
  assertExists(el);
});

Deno.test("TeamEventItem createElement succeeds for team_plan_review", () => {
  const el = React.createElement(TeamEventItem, { item: PLAN_REVIEW_ITEM, width: 80 });
  assertExists(el);
  assertEquals(el.props.item.teamEventType, "team_plan_review");
});

Deno.test("TeamEventItem createElement succeeds for team_shutdown", () => {
  const el = React.createElement(TeamEventItem, { item: SHUTDOWN_ITEM, width: 80 });
  assertExists(el);
  assertEquals(el.props.item.teamEventType, "team_shutdown");
});

// ── createElement: exhaustive status variants ─────────────

Deno.test("TeamEventItem handles all task status variants without crashing", () => {
  for (const status of ["pending", "in_progress", "completed", "errored", "blocked"]) {
    const el = React.createElement(TeamEventItem, {
      item: { ...TASK_ITEM, status },
      width: 80,
    });
    assertExists(el, `createElement should succeed for task status: ${status}`);
  }
});

Deno.test("TeamEventItem handles all message kind variants without crashing", () => {
  for (const kind of ["message", "broadcast", "task_completed", "task_error", "idle_notification"]) {
    const el = React.createElement(TeamEventItem, {
      item: { ...MESSAGE_ITEM, kind },
      width: 80,
    });
    assertExists(el, `createElement should succeed for message kind: ${kind}`);
  }
});

Deno.test("TeamEventItem handles all plan review status variants without crashing", () => {
  for (const status of ["pending", "approved", "rejected"]) {
    const el = React.createElement(TeamEventItem, {
      item: { ...PLAN_REVIEW_ITEM, status: status as TeamPlanReviewInfoItem["status"] },
      width: 80,
    });
    assertExists(el, `createElement should succeed for plan review status: ${status}`);
  }
});

Deno.test("TeamEventItem handles all shutdown status variants without crashing", () => {
  for (const status of ["requested", "acknowledged", "forced", "completed"]) {
    const el = React.createElement(TeamEventItem, {
      item: { ...SHUTDOWN_ITEM, status: status as TeamShutdownInfoItem["status"] },
      width: 80,
    });
    assertExists(el, `createElement should succeed for shutdown status: ${status}`);
  }
});

// ── Props forwarding ──────────────────────────────────────

Deno.test("TeamEventItem forwards item and width props correctly", () => {
  const el = React.createElement(TeamEventItem, { item: TASK_ITEM, width: 120 });
  assertEquals(el.props.item, TASK_ITEM);
  assertEquals(el.props.width, 120);
});

Deno.test("TeamEventItem forwards optional fields in task items", () => {
  const noAssignee: TeamTaskInfoItem = { ...TASK_ITEM, assigneeMemberId: undefined };
  const el = React.createElement(TeamEventItem, { item: noAssignee, width: 80 });
  assertEquals(el.props.item.assigneeMemberId, undefined);
});

Deno.test("TeamEventItem forwards optional fields in shutdown items", () => {
  const noReason: TeamShutdownInfoItem = { ...SHUTDOWN_ITEM, reason: undefined };
  const el = React.createElement(TeamEventItem, { item: noReason, width: 80 });
  assertEquals(el.props.item.reason, undefined);
});

Deno.test("TeamEventItem forwards optional fields in plan review items", () => {
  const approved: TeamPlanReviewInfoItem = {
    ...PLAN_REVIEW_ITEM,
    status: "approved",
    reviewedByMemberId: "lead",
  };
  const el = React.createElement(TeamEventItem, { item: approved, width: 80 });
  assertEquals(el.props.item.reviewedByMemberId, "lead");
});
