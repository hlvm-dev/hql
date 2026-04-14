/**
 * Agent TUI State Tests
 *
 * Tests the transcript state reducer handles agent events correctly.
 * Verifies that agent_spawn and agent_complete produce correct
 * ToolGroupItem structures that ToolCallItem.tsx can render.
 */

import {
  assertEquals,
  assertExists,
  assertStringIncludes,
} from "jsr:@std/assert";
import {
  reduceTranscriptState,
  type TranscriptState,
} from "../../../src/hlvm/cli/agent-transcript-state.ts";
import type {
  ToolGroupItem,
  ToolCallDisplay,
} from "../../../src/hlvm/cli/repl-ink/types.ts";
import { StreamingState } from "../../../src/hlvm/cli/repl-ink/types.ts";

// ============================================================
// Helpers
// ============================================================

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

function findAgentToolGroup(
  state: TranscriptState,
  agentId: string,
): ToolGroupItem | undefined {
  return state.items.find(
    (item): item is ToolGroupItem =>
      item.type === "tool_group" &&
      item.tools.some((t) => t.toolCallId === agentId),
  );
}

function findAgentTool(
  state: TranscriptState,
  agentId: string,
): ToolCallDisplay | undefined {
  const group = findAgentToolGroup(state, agentId);
  return group?.tools.find((t) => t.toolCallId === agentId);
}

// ============================================================
// agent_spawn event
// ============================================================

Deno.test("TUI: agent_spawn creates ToolGroupItem with correct fields", () => {
  const state = makeEmptyState();
  const next = reduceTranscriptState(state, {
    type: "agent_event",
    event: {
      type: "agent_spawn",
      agentId: "agent-1",
      agentType: "Explore",
      description: "Research auth system",
      isAsync: false,
    },
  });

  // Should have 1 item
  assertEquals(next.items.length, 1);
  const group = next.items[0] as ToolGroupItem;
  assertEquals(group.type, "tool_group");
  assertEquals(group.tools.length, 1);

  const tool = group.tools[0];
  assertEquals(tool.toolCallId, "agent-1");
  assertEquals(tool.name, "Agent(Explore)");
  assertEquals(tool.displayName, "Agent(Explore)");
  assertEquals(tool.argsSummary, "Research auth system");
  assertEquals(tool.status, "running");
  assertEquals(tool.progressText, "In progress…");
  assertEquals(tool.progressTone, "running");
  assertEquals(tool.toolIndex, 0);
  assertEquals(tool.toolTotal, 1);
});

Deno.test("TUI: agent_spawn async shows 'Backgrounded'", () => {
  const state = makeEmptyState();
  const next = reduceTranscriptState(state, {
    type: "agent_event",
    event: {
      type: "agent_spawn",
      agentId: "agent-2",
      agentType: "general-purpose",
      description: "Background task",
      isAsync: true,
    },
  });

  const tool = findAgentTool(next, "agent-2");
  assertExists(tool);
  assertEquals(tool!.progressText, "Backgrounded");
});

Deno.test("TUI: agent_spawn tool fields match ToolCallDisplay interface", () => {
  const state = makeEmptyState();
  const next = reduceTranscriptState(state, {
    type: "agent_event",
    event: {
      type: "agent_spawn",
      agentId: "agent-3",
      agentType: "Plan",
      description: "Design architecture",
      isAsync: false,
    },
  });

  const tool = findAgentTool(next, "agent-3");
  assertExists(tool);

  // Verify ALL required ToolCallDisplay fields exist
  // (these are what ToolCallItem.tsx expects)
  assertExists(tool!.id, "ToolCallDisplay requires 'id'");
  assertExists(tool!.name, "ToolCallDisplay requires 'name'");
  assertExists(tool!.argsSummary, "ToolCallDisplay requires 'argsSummary'");
  assertExists(tool!.status, "ToolCallDisplay requires 'status'");
  assertEquals(typeof tool!.toolIndex, "number", "ToolCallDisplay requires 'toolIndex'");
  assertEquals(typeof tool!.toolTotal, "number", "ToolCallDisplay requires 'toolTotal'");
});

// ============================================================
// agent_complete event
// ============================================================

Deno.test("TUI: agent_complete updates status to success", () => {
  let state = makeEmptyState();

  // First spawn
  state = reduceTranscriptState(state, {
    type: "agent_event",
    event: {
      type: "agent_spawn",
      agentId: "agent-4",
      agentType: "Explore",
      description: "Search files",
      isAsync: false,
    },
  });

  // Then complete
  state = reduceTranscriptState(state, {
    type: "agent_event",
    event: {
      type: "agent_complete",
      agentId: "agent-4",
      agentType: "Explore",
      success: true,
      durationMs: 3400,
      toolUseCount: 5,
      resultPreview: "Found 3 auth files",
    },
  });

  const tool = findAgentTool(state, "agent-4");
  assertExists(tool);
  assertEquals(tool!.status, "success");
  assertEquals(tool!.progressText, undefined); // Cleared on completion
  assertEquals(tool!.durationMs, 3400);
  assertStringIncludes(tool!.resultSummaryText!, "5 tool uses");
  assertStringIncludes(tool!.resultSummaryText!, "3.4s");
  assertEquals(tool!.resultDetailText, "Found 3 auth files");
});

Deno.test("TUI: agent_complete failure sets error status", () => {
  let state = makeEmptyState();

  state = reduceTranscriptState(state, {
    type: "agent_event",
    event: {
      type: "agent_spawn",
      agentId: "agent-5",
      agentType: "general-purpose",
      description: "Failing task",
      isAsync: false,
    },
  });

  state = reduceTranscriptState(state, {
    type: "agent_event",
    event: {
      type: "agent_complete",
      agentId: "agent-5",
      agentType: "general-purpose",
      success: false,
      durationMs: 500,
      toolUseCount: 0,
      resultPreview: "Agent encountered an error",
    },
  });

  const tool = findAgentTool(state, "agent-5");
  assertExists(tool);
  assertEquals(tool!.status, "error");
});

Deno.test("TUI: agent_complete with no prior spawn is a no-op", () => {
  const state = makeEmptyState();
  const next = reduceTranscriptState(state, {
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

  // No items should be created for a complete without spawn
  assertEquals(next.items.length, 0);
});

// ============================================================
// Full lifecycle: spawn → complete
// ============================================================

Deno.test("TUI: full lifecycle renders CC-like output structure", () => {
  let state = makeEmptyState();

  // Spawn
  state = reduceTranscriptState(state, {
    type: "agent_event",
    event: {
      type: "agent_spawn",
      agentId: "lifecycle-1",
      agentType: "Explore",
      description: "Research auth",
      isAsync: false,
    },
  });

  // At this point, the TUI would render:
  // ⏺ RUNNING Agent(Explore) Research auth
  //   ⎿  In progress…
  const running = findAgentTool(state, "lifecycle-1");
  assertExists(running);
  assertEquals(running!.status, "running");
  assertEquals(running!.name, "Agent(Explore)");
  assertEquals(running!.argsSummary, "Research auth");
  assertEquals(running!.progressText, "In progress…");

  // Complete (with token count — CC shows "N tokens")
  state = reduceTranscriptState(state, {
    type: "agent_event",
    event: {
      type: "agent_complete",
      agentId: "lifecycle-1",
      agentType: "Explore",
      success: true,
      durationMs: 8200,
      toolUseCount: 12,
      totalTokens: 5000,
      resultPreview: "Found auth middleware in src/middleware.ts",
    },
  });

  // At this point, the TUI renders (CC format):
  // ⏺ DONE Agent(Explore) Research auth (8.2s)
  //   ⎿  Done (12 tool uses · 5,000 tokens · 8.2s)
  const done = findAgentTool(state, "lifecycle-1");
  assertExists(done);
  assertEquals(done!.status, "success");
  assertStringIncludes(done!.resultSummaryText!, "12 tool");
  assertStringIncludes(done!.resultSummaryText!, "5,000 tokens");
  assertStringIncludes(done!.resultSummaryText!, "8.2s");
  assertEquals(done!.resultDetailText, "Found auth middleware in src/middleware.ts");
  assertEquals(done!.durationMs, 8200);
  assertEquals(done!.progressText, undefined);
});

// ============================================================
// Multiple agents
// ============================================================

Deno.test("TUI: agent_progress updates running text with tool count", () => {
  let state = makeEmptyState();

  // Spawn
  state = reduceTranscriptState(state, {
    type: "agent_event",
    event: {
      type: "agent_spawn",
      agentId: "progress-1",
      agentType: "Explore",
      description: "Search files",
      isAsync: false,
    },
  });

  // Progress after 3 tool uses, 2.5 seconds
  state = reduceTranscriptState(state, {
    type: "agent_event",
    event: {
      type: "agent_progress",
      agentId: "progress-1",
      agentType: "Explore",
      toolUseCount: 3,
      durationMs: 2500,
    },
  });

  const tool = findAgentTool(state, "progress-1");
  assertExists(tool);
  assertEquals(tool!.status, "running");
  // CC format: "In progress… · 3 tool uses · 2.5s"
  assertStringIncludes(tool!.progressText!, "3 tool uses");
  assertStringIncludes(tool!.progressText!, "2.5s");
});

Deno.test("TUI: agent_progress singular 'tool use' for count=1", () => {
  let state = makeEmptyState();

  state = reduceTranscriptState(state, {
    type: "agent_event",
    event: {
      type: "agent_spawn",
      agentId: "progress-2",
      agentType: "Explore",
      description: "Quick search",
      isAsync: false,
    },
  });

  state = reduceTranscriptState(state, {
    type: "agent_event",
    event: {
      type: "agent_progress",
      agentId: "progress-2",
      agentType: "Explore",
      toolUseCount: 1,
      durationMs: 500,
    },
  });

  const tool = findAgentTool(state, "progress-2");
  assertExists(tool);
  // CC: "1 tool use" (singular), not "1 tool uses"
  assertStringIncludes(tool!.progressText!, "1 tool use");
  assertEquals(tool!.progressText!.includes("1 tool uses"), false);
});

Deno.test("TUI: agent_complete with transcript stores it in resultDetailText", () => {
  let state = makeEmptyState();

  state = reduceTranscriptState(state, {
    type: "agent_event",
    event: {
      type: "agent_spawn",
      agentId: "transcript-1",
      agentType: "Explore",
      description: "Search",
      isAsync: false,
    },
  });

  state = reduceTranscriptState(state, {
    type: "agent_event",
    event: {
      type: "agent_complete",
      agentId: "transcript-1",
      agentType: "Explore",
      success: true,
      durationMs: 2000,
      toolUseCount: 3,
      resultPreview: "Found 3 files",
      transcript: "  search_code auth\n  ⎿ ok (50ms)\n  read_file auth.ts\n  ⎿ ok (20ms)",
    },
  });

  const tool = findAgentTool(state, "transcript-1");
  assertExists(tool);
  // resultDetailText should contain both preview and transcript
  assertStringIncludes(tool!.resultDetailText!, "Found 3 files");
  assertStringIncludes(tool!.resultDetailText!, "Agent Transcript");
  assertStringIncludes(tool!.resultDetailText!, "search_code auth");
  assertStringIncludes(tool!.resultDetailText!, "read_file auth.ts");
});

Deno.test("TUI: agent_complete without transcript only shows preview", () => {
  let state = makeEmptyState();

  state = reduceTranscriptState(state, {
    type: "agent_event",
    event: {
      type: "agent_spawn",
      agentId: "notranscript-1",
      agentType: "general-purpose",
      description: "Quick task",
      isAsync: false,
    },
  });

  state = reduceTranscriptState(state, {
    type: "agent_event",
    event: {
      type: "agent_complete",
      agentId: "notranscript-1",
      agentType: "general-purpose",
      success: true,
      durationMs: 500,
      toolUseCount: 0,
      resultPreview: "Done quickly",
      // No transcript (no tool calls were made)
    },
  });

  const tool = findAgentTool(state, "notranscript-1");
  assertExists(tool);
  assertEquals(tool!.resultDetailText, "Done quickly");
});

Deno.test("TUI: multiple simultaneous agents each get their own group", () => {
  let state = makeEmptyState();

  state = reduceTranscriptState(state, {
    type: "agent_event",
    event: {
      type: "agent_spawn",
      agentId: "multi-1",
      agentType: "Explore",
      description: "Search frontend",
      isAsync: true,
    },
  });

  state = reduceTranscriptState(state, {
    type: "agent_event",
    event: {
      type: "agent_spawn",
      agentId: "multi-2",
      agentType: "Explore",
      description: "Search backend",
      isAsync: true,
    },
  });

  // Should have 2 tool group items
  const groups = state.items.filter((i) => i.type === "tool_group");
  assertEquals(groups.length, 2);

  const agent1 = findAgentTool(state, "multi-1");
  const agent2 = findAgentTool(state, "multi-2");
  assertExists(agent1);
  assertExists(agent2);
  assertEquals(agent1!.argsSummary, "Search frontend");
  assertEquals(agent2!.argsSummary, "Search backend");
});
