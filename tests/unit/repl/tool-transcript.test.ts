import { assertEquals } from "jsr:@std/assert@1";
import {
  buildToolTranscriptInvocationLabel,
  resolveToolTranscriptDisplayName,
  resolveToolTranscriptGroupSummary,
  resolveToolTranscriptProgress,
  resolveToolTranscriptResult,
} from "../../../src/hlvm/cli/repl-ink/components/conversation/tool-transcript.ts";

Deno.test("buildToolTranscriptInvocationLabel formats web tools with quoted args", () => {
  assertEquals(
    buildToolTranscriptInvocationLabel({
      name: "search_web",
      displayName: "Web Search",
      argsSummary: 'react "19" release notes',
    }),
    'Web Search("react \'19\' release notes")',
  );
});

Deno.test("resolveToolTranscriptDisplayName uses compact labels for team tools", () => {
  assertEquals(resolveToolTranscriptDisplayName("TaskCreate"), "Create Task");
  assertEquals(resolveToolTranscriptDisplayName("TeamStatus"), "Team Status");
});

Deno.test("resolveToolTranscriptProgress uses adapter defaults for web search start", () => {
  assertEquals(
    resolveToolTranscriptProgress("search_web", {
      name: "search_web",
      argsSummary: "react 19 release notes",
      message: "",
      tone: "running",
      phase: "start",
    }),
    {
      message: "Searching: react 19 release notes",
      tone: "running",
    },
  );
});

Deno.test("resolveToolTranscriptResult formats fetch summaries from web meta", () => {
  assertEquals(
    resolveToolTranscriptResult("web_fetch", {
      name: "web_fetch",
      success: true,
      content: "full fetched page content",
      durationMs: 950,
      argsSummary: "https://react.dev/blog/react-19",
      meta: {
        webFetch: {
          status: 200,
          bytes: 49_152,
        },
      },
    }),
    {
      summaryText: "Received 48 KB (200)",
      detailText: "full fetched page content",
    },
  );
});

Deno.test("resolveToolTranscriptGroupSummary uses web-search transcript prose", () => {
  assertEquals(
    resolveToolTranscriptGroupSummary("search_web", [{
      name: "search_web",
      displayName: "Web Search",
      argsSummary: "react 19 release notes",
      status: "success",
      resultSummaryText: "Did 1 search in 1.7s",
      resultMeta: {
        webSearch: {
          sourceGuard: {
            resultCount: 10,
          },
        },
      },
    }, {
      name: "search_web",
      displayName: "Web Search",
      argsSummary: "react compiler docs",
      status: "success",
      resultSummaryText: "Did 1 search in 1.2s",
      resultMeta: {
        webSearch: {
          sourceGuard: {
            resultCount: 6,
          },
        },
      },
    }]),
    "Searched the web for 2 queries · 16 results",
  );
});

Deno.test("resolveToolTranscriptResult formats task list summaries for the transcript", () => {
  assertEquals(
    resolveToolTranscriptResult("TaskList", {
      name: "TaskList",
      success: true,
      content: JSON.stringify({
        tasks: [
          { id: "1", status: "pending" },
          { id: "2", status: "in_progress" },
          { id: "3", status: "blocked" },
        ],
      }),
      durationMs: 120,
      argsSummary: "team tasks",
    }),
    {
      summaryText: "Listed 3 tasks · 1 active · 1 pending · 1 blocked",
      detailText: JSON.stringify({
        tasks: [
          { id: "1", status: "pending" },
          { id: "2", status: "in_progress" },
          { id: "3", status: "blocked" },
        ],
      }),
    },
  );
});

Deno.test("resolveToolTranscriptResult formats team status summaries for the transcript", () => {
  assertEquals(
    resolveToolTranscriptResult("TeamStatus", {
      name: "TeamStatus",
      success: true,
      content: JSON.stringify({
        summary: {
          activeMembers: 4,
          pendingApprovals: 1,
          unreadMessages: 2,
          taskCounts: {
            pending: 1,
            claimed: 0,
            in_progress: 2,
            blocked: 0,
            completed: 1,
            cancelled: 0,
            errored: 0,
          },
        },
      }),
      durationMs: 180,
      argsSummary: "",
    }),
    {
      summaryText: "4 active members · 4 tasks · 1 pending approval · 2 unread",
      detailText: JSON.stringify({
        summary: {
          activeMembers: 4,
          pendingApprovals: 1,
          unreadMessages: 2,
          taskCounts: {
            pending: 1,
            claimed: 0,
            in_progress: 2,
            blocked: 0,
            completed: 1,
            cancelled: 0,
            errored: 0,
          },
        },
      }),
    },
  );
});
