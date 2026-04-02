import { assertEquals } from "jsr:@std/assert";
import {
  type DelegateTranscriptSnapshot,
  formatDelegateTranscriptEvent,
  listDelegateTranscriptLines,
} from "../../../src/hlvm/agent/delegate-transcript.ts";

Deno.test("delegate transcript formatter produces canonical event strings", () => {
  assertEquals(
    formatDelegateTranscriptEvent({
      type: "reasoning",
      iteration: 1,
      summary: "Inspect docs first.",
    }),
    "Reasoning: Inspect docs first.",
  );
  assertEquals(
    formatDelegateTranscriptEvent({
      type: "tool_end",
      name: "search_web",
      success: false,
      content: "network timeout\nretry later",
      durationMs: 1530,
      argsSummary: "docs",
    }),
    "Tool search_web failed: network timeout",
  );
  assertEquals(
    formatDelegateTranscriptEvent({
      type: "tool_progress",
      name: "search_web",
      argsSummary: "docs",
      message: 'Found 5 results for "docs"',
    }),
    'Tool search_web: Found 5 results for "docs"',
  );
});

Deno.test("delegate transcript formatter includes final response once", () => {
  const snapshot: DelegateTranscriptSnapshot = {
    agent: "web",
    task: "Inspect docs",
    success: true,
    durationMs: 900,
    toolCount: 1,
    finalResponse: "Found the relevant docs section.",
    events: [{
      type: "turn_stats",
      iteration: 1,
      toolCount: 1,
      durationMs: 900,
    }],
  };

  assertEquals(listDelegateTranscriptLines(snapshot), [
    "1 tool · 900ms",
    "Final: Found the relevant docs section.",
  ]);
});
