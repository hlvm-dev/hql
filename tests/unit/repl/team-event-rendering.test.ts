import { assertEquals } from "jsr:@std/assert@1";
import {
  getTeamMessageGlyph,
  getTeamMessageTone,
  getTeamPlanReviewGlyph,
  getTeamPlanReviewTone,
  getTeamShutdownGlyph,
  getTeamShutdownTone,
  getTeamTaskStatusGlyph,
  getTeamTaskStatusTone,
} from "../../../src/hlvm/cli/repl-ink/components/conversation/conversation-chrome.ts";

// ── Team Task Status ──────────────────────────────────────

Deno.test("getTeamTaskStatusTone maps pending to neutral", () => {
  assertEquals(getTeamTaskStatusTone("pending"), "neutral");
});

Deno.test("getTeamTaskStatusTone maps in_progress to active", () => {
  assertEquals(getTeamTaskStatusTone("in_progress"), "active");
});

Deno.test("getTeamTaskStatusTone maps completed to success", () => {
  assertEquals(getTeamTaskStatusTone("completed"), "success");
});

Deno.test("getTeamTaskStatusTone maps errored to error", () => {
  assertEquals(getTeamTaskStatusTone("errored"), "error");
});

Deno.test("getTeamTaskStatusTone maps blocked to warning", () => {
  assertEquals(getTeamTaskStatusTone("blocked"), "warning");
});

Deno.test("getTeamTaskStatusGlyph maps pending to ○", () => {
  assertEquals(getTeamTaskStatusGlyph("pending"), "○");
});

Deno.test("getTeamTaskStatusGlyph maps in_progress to ●", () => {
  assertEquals(getTeamTaskStatusGlyph("in_progress"), "●");
});

Deno.test("getTeamTaskStatusGlyph maps completed to ✓", () => {
  assertEquals(getTeamTaskStatusGlyph("completed"), "✓");
});

Deno.test("getTeamTaskStatusGlyph maps errored to ✗", () => {
  assertEquals(getTeamTaskStatusGlyph("errored"), "✗");
});

Deno.test("getTeamTaskStatusGlyph maps blocked to ⚠", () => {
  assertEquals(getTeamTaskStatusGlyph("blocked"), "⚠");
});

// ── Team Message ──────────────────────────────────────────

Deno.test("getTeamMessageTone maps idle_notification to neutral", () => {
  assertEquals(getTeamMessageTone("idle_notification"), "neutral");
});

Deno.test("getTeamMessageTone maps task_completed to success", () => {
  assertEquals(getTeamMessageTone("task_completed"), "success");
});

Deno.test("getTeamMessageTone maps task_error to error", () => {
  assertEquals(getTeamMessageTone("task_error"), "error");
});

Deno.test("getTeamMessageTone maps message to active", () => {
  assertEquals(getTeamMessageTone("message"), "active");
});

Deno.test("getTeamMessageTone maps broadcast to active", () => {
  assertEquals(getTeamMessageTone("broadcast"), "active");
});

Deno.test("getTeamMessageGlyph maps idle_notification to ○", () => {
  assertEquals(getTeamMessageGlyph("idle_notification"), "○");
});

Deno.test("getTeamMessageGlyph maps task_completed to ✓", () => {
  assertEquals(getTeamMessageGlyph("task_completed"), "✓");
});

Deno.test("getTeamMessageGlyph maps task_error to ✗", () => {
  assertEquals(getTeamMessageGlyph("task_error"), "✗");
});

Deno.test("getTeamMessageGlyph maps message to ✉", () => {
  assertEquals(getTeamMessageGlyph("message"), "✉");
});

Deno.test("getTeamMessageGlyph maps broadcast to 📢", () => {
  assertEquals(getTeamMessageGlyph("broadcast"), "📢");
});

// ── Team Shutdown ─────────────────────────────────────────

Deno.test("getTeamShutdownTone maps requested to warning", () => {
  assertEquals(getTeamShutdownTone("requested"), "warning");
});

Deno.test("getTeamShutdownTone maps acknowledged to active", () => {
  assertEquals(getTeamShutdownTone("acknowledged"), "active");
});

Deno.test("getTeamShutdownTone maps forced to error", () => {
  assertEquals(getTeamShutdownTone("forced"), "error");
});

Deno.test("getTeamShutdownTone maps completed to neutral", () => {
  assertEquals(getTeamShutdownTone("completed"), "neutral");
});

Deno.test("getTeamShutdownGlyph maps requested to ⚠", () => {
  assertEquals(getTeamShutdownGlyph("requested"), "⚠");
});

Deno.test("getTeamShutdownGlyph maps acknowledged to ●", () => {
  assertEquals(getTeamShutdownGlyph("acknowledged"), "●");
});

Deno.test("getTeamShutdownGlyph maps forced to ✗", () => {
  assertEquals(getTeamShutdownGlyph("forced"), "✗");
});

Deno.test("getTeamShutdownGlyph maps completed to ○", () => {
  assertEquals(getTeamShutdownGlyph("completed"), "○");
});

// ── Team Plan Review ──────────────────────────────────────

Deno.test("getTeamPlanReviewTone maps pending to warning", () => {
  assertEquals(getTeamPlanReviewTone("pending"), "warning");
});

Deno.test("getTeamPlanReviewTone maps approved to success", () => {
  assertEquals(getTeamPlanReviewTone("approved"), "success");
});

Deno.test("getTeamPlanReviewTone maps rejected to error", () => {
  assertEquals(getTeamPlanReviewTone("rejected"), "error");
});

Deno.test("getTeamPlanReviewGlyph maps pending to ○", () => {
  assertEquals(getTeamPlanReviewGlyph("pending"), "○");
});

Deno.test("getTeamPlanReviewGlyph maps approved to ✓", () => {
  assertEquals(getTeamPlanReviewGlyph("approved"), "✓");
});

Deno.test("getTeamPlanReviewGlyph maps rejected to ✗", () => {
  assertEquals(getTeamPlanReviewGlyph("rejected"), "✗");
});
