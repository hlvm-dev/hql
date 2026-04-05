import { assert, assertEquals, assertStringIncludes } from "jsr:@std/assert";
import {
  checkGrounding,
  type ToolUse,
} from "../../../src/hlvm/agent/grounding.ts";

Deno.test("grounding: plain answers without tool claims stay grounded", () => {
  const result = checkGrounding("Here is the answer.", []);
  assertEquals(result.grounded, true);
  assertEquals(result.warnings.length, 0);
});

Deno.test("grounding: fabricated tool-result headers are rejected", () => {
  for (
    const response of [
      "[Tool Result] stdout: 4\nFinal: 4",
      "Tool Result: stdout: 4\nFinal: 4",
    ]
  ) {
    const result = checkGrounding(response, []);
    assertEquals(result.grounded, false);
    assert(result.warnings.length >= 1);
    assertStringIncludes(result.warnings.join("\n"), "Tool Result");
  }
});

Deno.test("grounding: unknown tool references are rejected even without real tool usage", () => {
  const result = checkGrounding(
    'Using the "html-parse" tool, I extracted the content.',
    [],
  );
  assertEquals(result.grounded, false);
  assert(result.warnings.length >= 1);
  assertStringIncludes(result.warnings.join("\n"), "unknown tool");
});

Deno.test("grounding: real tool usage can be grounded by citation, normalized name, or concrete data overlap", () => {
  const namedTool: ToolUse[] = [{
    toolName: "list_files",
    result: "file1\nfile2",
  }];
  const normalizedTool: ToolUse[] = [{
    toolName: "get_structure",
    result: "tree",
  }];
  const numericTool: ToolUse[] = [{ toolName: "compute", result: "4" }];
  const citedWebTool: ToolUse[] = [{
    toolName: "search_web",
    result: "non-json formatted result",
  }];

  assertEquals(
    checkGrounding("Based on list_files, there are 2 files.", namedTool)
      .grounded,
    true,
  );
  assertEquals(
    checkGrounding(
      "According to get structure, here is the tree.",
      normalizedTool,
    ).grounded,
    true,
  );
  assertEquals(
    checkGrounding("The result of the expression '2+2' is 4.", numericTool)
      .grounded,
    true,
  );
  assertEquals(
    checkGrounding(
      "TaskGroup cancels sibling tasks on failure.",
      citedWebTool,
      [{
        url: "https://docs.python.org/3/library/asyncio-task.html",
        title: "asyncio task docs",
        startIndex: 0,
        endIndex: 42,
        confidence: 0.78,
      }],
    ).grounded,
    true,
  );
});

Deno.test("grounding: uncited non-web claims still fail even when another claim has citations", () => {
  const toolUses: ToolUse[] = [
    { toolName: "search_web", result: "non-json formatted result" },
    { toolName: "list_files", result: '{"count": 270, "files": [...]}' },
  ];
  const result = checkGrounding(
    "TaskGroup cancels sibling tasks on failure. I found some files in the directory.",
    toolUses,
    [{
      url: "https://docs.python.org/3/library/asyncio-task.html",
      title: "asyncio task docs",
      startIndex: 0,
      endIndex: 42,
      confidence: 0.78,
    }],
  );
  assertEquals(result.grounded, false);
  assert(result.warnings.length >= 1);
});

Deno.test("grounding: custom web search payload citations still count without provider spans", () => {
  const result = checkGrounding(
    "The official docs confirm the API exists.",
    [{
      toolName: "search_web",
      result: JSON.stringify({
        citations: [{
          url: "https://example.com/docs",
          title: "Docs",
        }],
      }),
    }],
  );

  assertEquals(result.grounded, true);
});

Deno.test("grounding: empty citation-backed web search can safely ask for clarification without citations", () => {
  const result = checkGrounding(
    "Based on search_web, the search returned no results. Please clarify the query.",
    [{
      toolName: "search_web",
      result: JSON.stringify({
        query: "hlvm",
        provider: "duckduckgo",
        results: [],
        count: 0,
      }),
    }],
  );

  assertEquals(result.grounded, true);
});
