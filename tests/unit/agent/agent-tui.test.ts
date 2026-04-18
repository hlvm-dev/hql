import { assertEquals, assertExists } from "jsr:@std/assert";
import {
  reduceTranscriptState,
  type TranscriptState,
} from "../../../src/hlvm/cli/agent-transcript-state.ts";
import type { ToolGroupItem } from "../../../src/hlvm/cli/repl-ink/types.ts";
import { StreamingState } from "../../../src/hlvm/cli/repl-ink/types.ts";

function makeEmptyState(): TranscriptState {
  return {
    items: [],
    nextId: 1,
    streamingState: StreamingState.Idle,
    currentTurnId: "test-turn",
    completedPlanStepIds: [],
    turnCounter: 0,
  };
}

Deno.test("TUI transcript: local agent lifecycle events do not create transcript rows", () => {
  let state = makeEmptyState();

  state = reduceTranscriptState(state, {
    type: "agent_event",
    event: {
      type: "agent_spawn",
      agentId: "agent-1",
      agentType: "Explore",
      description: "Research auth system",
      isAsync: true,
    },
  });

  state = reduceTranscriptState(state, {
    type: "agent_event",
    event: {
      type: "agent_progress",
      agentId: "agent-1",
      agentType: "Explore",
      toolUseCount: 3,
      durationMs: 2500,
    },
  });

  state = reduceTranscriptState(state, {
    type: "agent_event",
    event: {
      type: "agent_complete",
      agentId: "agent-1",
      agentType: "Explore",
      success: true,
      durationMs: 3400,
      toolUseCount: 5,
      resultPreview: "Found 3 auth files",
    },
  });

  assertEquals(state.items.length, 0);
  assertEquals(state.streamingState, StreamingState.Idle);
});

Deno.test("TUI transcript: agent events do not disturb regular tool transcript groups", () => {
  let state = makeEmptyState();

  state = reduceTranscriptState(state, {
    type: "agent_event",
    event: {
      type: "agent_spawn",
      agentId: "agent-2",
      agentType: "Plan",
      description: "Background planning",
      isAsync: true,
    },
  });

  state = reduceTranscriptState(state, {
    type: "agent_event",
    event: {
      type: "tool_start",
      toolCallId: "tool-1",
      name: "search_web",
      argsSummary: "query=auth middleware",
      toolIndex: 1,
      toolTotal: 1,
    },
  });

  const group = state.items[0] as ToolGroupItem | undefined;
  assertExists(group);
  assertEquals(group.type, "tool_group");
  assertEquals(group.tools.length, 1);
  assertEquals(group.tools[0].toolCallId, "tool-1");
  assertEquals(group.tools[0].name, "search_web");
  assertEquals(group.tools[0].status, "running");
});

Deno.test("TUI transcript: agent completion without transcript entries remains a no-op", () => {
  const next = reduceTranscriptState(makeEmptyState(), {
    type: "agent_event",
    event: {
      type: "agent_complete",
      agentId: "nonexistent",
      agentType: "Explore",
      success: true,
      durationMs: 100,
      toolUseCount: 0,
    },
  });

  assertEquals(next.items.length, 0);
  assertEquals(next.streamingState, StreamingState.Idle);
});
