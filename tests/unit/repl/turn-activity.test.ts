import { assertEquals } from "jsr:@std/assert";
import {
  deriveLiveTurnStatus,
  getRecentLiveActivityLabels,
  getRecentTurnActivityTrail,
  isProminentToolName,
  summarizeTurnCompletion,
} from "../../../src/hlvm/cli/repl-ink/components/conversation/turn-activity.ts";
import { StreamingState } from "../../../src/hlvm/cli/repl-ink/types.ts";
import type { ConversationItem } from "../../../src/hlvm/cli/repl-ink/types.ts";

Deno.test("deriveLiveTurnStatus surfaces waiting clarification state", () => {
  const status = deriveLiveTurnStatus({
    items: [{
      type: "info",
      id: "info-1",
      text: "Clarification needed: Which output format do you want?",
      ts: 1,
    }],
    streamingState: StreamingState.WaitingForConfirmation,
  });

  assertEquals(status, {
    label: "Clarification needed",
    tone: "warning",
    recentLabels: [],
  });
});

Deno.test("deriveLiveTurnStatus surfaces active tool activity labels", () => {
  const status = deriveLiveTurnStatus({
    items: [{
      type: "tool_group",
      id: "tool-group-1",
      ts: 1,
      tools: [{
        id: "tool-1",
        name: "write_file",
        argsSummary: "/tmp/stock_prediction_visual.html",
        status: "running",
        toolIndex: 1,
        toolTotal: 1,
      }],
    }],
    streamingState: StreamingState.Responding,
  });

  assertEquals(status?.label, "Writing stock_prediction_visual.html");
  assertEquals(status?.tone, "active");
});

Deno.test("deriveLiveTurnStatus prefers running tool progress text for web search", () => {
  const status = deriveLiveTurnStatus({
    items: [{
      type: "tool_group",
      id: "tool-group-1",
      ts: 1,
      tools: [{
        id: "tool-1",
        name: "search_web",
        displayName: "Web Search",
        argsSummary: "react 19 release notes",
        status: "running",
        progressText: 'Found 10 results for "react 19 release notes"',
        progressTone: "running",
        toolIndex: 1,
        toolTotal: 1,
      }],
    }],
    streamingState: StreamingState.Responding,
  });

  assertEquals(status?.label, 'Found 10 results for "react 19 release notes"');
  assertEquals(status?.tone, "active");
});

Deno.test("summarizeTurnCompletion prefers important completed actions", () => {
  const items: ConversationItem[] = [{
    type: "tool_group",
    id: "tool-group-1",
    ts: 1,
    tools: [
      {
        id: "tool-1",
        name: "write_file",
        argsSummary: "/tmp/stock_prediction_visual.html",
        status: "success",
        resultSummaryText: "Wrote file",
        toolIndex: 1,
        toolTotal: 2,
      },
      {
        id: "tool-2",
        name: "open_path",
        argsSummary: "/tmp/stock_prediction_visual.html",
        status: "success",
        resultSummaryText: "Opened file",
        toolIndex: 2,
        toolTotal: 2,
      },
    ],
  }];

  assertEquals(
    summarizeTurnCompletion(items),
    "Wrote stock_prediction_visual.html · Opened stock_prediction_visual.html",
  );
});

Deno.test("getRecentLiveActivityLabels returns recent derived summaries", () => {
  const labels = getRecentLiveActivityLabels([{
    type: "tool_group",
    id: "tool-group-1",
    ts: 1,
    tools: [{
      id: "tool-1",
      name: "read_file",
      argsSummary: "src/hlvm/cli/repl-ink/components/PendingTurnPanel.tsx",
      status: "success",
      resultSummaryText: "Read 200 lines",
      toolIndex: 1,
      toolTotal: 1,
    }],
  }]);

  assertEquals(labels, ["Reading PendingTurnPanel.tsx"]);
});

Deno.test("isProminentToolName identifies high-signal tools", () => {
  assertEquals(isProminentToolName("write_file"), true);
  assertEquals(isProminentToolName("edit_file"), true);
  assertEquals(isProminentToolName("open_path"), true);
  assertEquals(isProminentToolName("shell_exec"), true);
  assertEquals(isProminentToolName("search_web"), false);
});

Deno.test("getRecentTurnActivityTrail prefers tool activity over final assistant prose", () => {
  const trail = getRecentTurnActivityTrail([
    {
      type: "tool_group",
      id: "tool-group-1",
      ts: 1,
      tools: [{
        id: "tool-1",
        name: "search_web",
        argsSummary: "tesla analyst targets",
        status: "success",
        resultSummaryText: "Found 10 results",
        toolIndex: 1,
        toolTotal: 1,
      }],
    },
    {
      type: "assistant",
      id: "assistant-1",
      text: "Here is the final answer with sources.",
      isPending: false,
      ts: 2,
    },
  ]);

  assertEquals(trail, ["Researching tesla analyst targets"]);
});

Deno.test("deriveLiveTurnStatus does not echo visible assistant prose as live activity", () => {
  const status = deriveLiveTurnStatus({
    items: [{
      type: "assistant",
      id: "assistant-1",
      text: "Here is the final answer with sources.",
      isPending: false,
      ts: 1,
    }],
    streamingState: StreamingState.Responding,
  });

  assertEquals(status, undefined);
});
