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

Deno.test("getTeamTaskStatusTone maps statuses correctly", async (t) => {
  const cases: [string, string][] = [
    ["pending", "neutral"],
    ["in_progress", "active"],
    ["completed", "success"],
    ["errored", "error"],
    ["blocked", "warning"],
  ];
  for (const [input, expected] of cases) {
    await t.step(`${input} → ${expected}`, () => {
      assertEquals(getTeamTaskStatusTone(input), expected);
    });
  }
});

Deno.test("getTeamTaskStatusGlyph maps statuses correctly", async (t) => {
  const cases: [string, string][] = [
    ["pending", "○"],
    ["in_progress", "●"],
    ["completed", "✓"],
    ["errored", "✗"],
    ["blocked", "⚠"],
  ];
  for (const [input, expected] of cases) {
    await t.step(`${input} → ${expected}`, () => {
      assertEquals(getTeamTaskStatusGlyph(input), expected);
    });
  }
});

// ── Team Message ──────────────────────────────────────────

Deno.test("getTeamMessageTone maps kinds correctly", async (t) => {
  const cases: [string, string][] = [
    ["idle_notification", "neutral"],
    ["task_completed", "success"],
    ["task_error", "error"],
    ["message", "active"],
    ["broadcast", "active"],
  ];
  for (const [input, expected] of cases) {
    await t.step(`${input} → ${expected}`, () => {
      assertEquals(getTeamMessageTone(input), expected);
    });
  }
});

Deno.test("getTeamMessageGlyph maps kinds correctly", async (t) => {
  const cases: [string, string][] = [
    ["idle_notification", "○"],
    ["task_completed", "✓"],
    ["task_error", "✗"],
    ["message", "✉"],
    ["broadcast", "📢"],
  ];
  for (const [input, expected] of cases) {
    await t.step(`${input} → ${expected}`, () => {
      assertEquals(getTeamMessageGlyph(input), expected);
    });
  }
});

// ── Team Shutdown ─────────────────────────────────────────

Deno.test("getTeamShutdownTone maps statuses correctly", async (t) => {
  const cases: [string, string][] = [
    ["requested", "warning"],
    ["acknowledged", "active"],
    ["forced", "error"],
    ["completed", "neutral"],
  ];
  for (const [input, expected] of cases) {
    await t.step(`${input} → ${expected}`, () => {
      assertEquals(getTeamShutdownTone(input), expected);
    });
  }
});

Deno.test("getTeamShutdownGlyph maps statuses correctly", async (t) => {
  const cases: [string, string][] = [
    ["requested", "⚠"],
    ["acknowledged", "●"],
    ["forced", "✗"],
    ["completed", "○"],
  ];
  for (const [input, expected] of cases) {
    await t.step(`${input} → ${expected}`, () => {
      assertEquals(getTeamShutdownGlyph(input), expected);
    });
  }
});

// ── Team Plan Review ──────────────────────────────────────

Deno.test("getTeamPlanReviewTone maps statuses correctly", async (t) => {
  const cases: [string, string][] = [
    ["pending", "warning"],
    ["approved", "success"],
    ["rejected", "error"],
  ];
  for (const [input, expected] of cases) {
    await t.step(`${input} → ${expected}`, () => {
      assertEquals(getTeamPlanReviewTone(input), expected);
    });
  }
});

Deno.test("getTeamPlanReviewGlyph maps statuses correctly", async (t) => {
  const cases: [string, string][] = [
    ["pending", "○"],
    ["approved", "✓"],
    ["rejected", "✗"],
  ];
  for (const [input, expected] of cases) {
    await t.step(`${input} → ${expected}`, () => {
      assertEquals(getTeamPlanReviewGlyph(input), expected);
    });
  }
});
