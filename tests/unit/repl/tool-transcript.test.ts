import { assertEquals } from "jsr:@std/assert@1";
import {
  buildToolTranscriptInvocationLabel,
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

