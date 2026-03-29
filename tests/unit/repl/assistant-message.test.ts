import { assertEquals } from "jsr:@std/assert";
import {
  buildCitationRenderView,
  buildCompactSourceLines,
} from "../../../src/hlvm/cli/repl-ink/components/conversation/AssistantMessage.tsx";

Deno.test("buildCitationRenderView annotates text and groups citations by source", () => {
  const view = buildCitationRenderView("Tesla may rise next week.", [{
    url: "https://example.com/a",
    title: "Source A",
    startIndex: 0,
    endIndex: 5,
  }, {
    url: "https://example.com/b",
    title: "Source B",
    startIndex: 10,
    endIndex: 14,
  }]);

  assertEquals(view.text, "Tesla[1] may rise[2] next week.");
  assertEquals(view.sources.map((source) => source.title), [
    "Source A",
    "Source B",
  ]);
});

Deno.test("buildCompactSourceLines compacts citations into two transcript lines", () => {
  const lines = buildCompactSourceLines(
    [
      {
        index: 1,
        url: "https://example.com/a",
        title: "Tesla Forecast",
        spans: [],
      },
      {
        index: 2,
        url: "https://example.com/b",
        title: "Analyst Targets",
        spans: [],
      },
      {
        index: 3,
        url: "https://example.com/c",
        title: "Market Recap",
        spans: [],
      },
    ],
    4,
    "Sources",
  );

  assertEquals(lines, [
    "Sources [1] Tesla Forecast · [2] Analyst Targets · [3] Market Recap",
    "+4 more sources · Ctrl+Y opens latest source",
  ]);
});
