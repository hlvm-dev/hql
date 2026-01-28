/**
 * Orchestrator Error Reporting Tests
 *
 * Tests for Issues #2, #3 - Parse Error Reporting & Self-Teaching Protocol
 */

import { assertEquals, assertStringIncludes } from "jsr:@std/assert";
import { parseToolCalls } from "../../../src/hlvm/agent/orchestrator.ts";

// ============================================================
// Issue #2: JSON Parse Error Reporting
// ============================================================

Deno.test({
  name: "parseToolCalls - JSON parse error includes line number",
  fn() {
    const response = `Let me try this.
TOOL_CALL
{"toolName": "read_file", "args": {"path": "test.ts"}
END_TOOL_CALL`;

    const result = parseToolCalls(response);
    assertEquals(result.calls.length, 0);
    assertEquals(result.errors.length, 1);
    assertEquals(result.errors[0].type, "json_parse");
    assertEquals(result.errors[0].line, 2); // Line 2 (1-indexed)
    assertStringIncludes(result.errors[0].message, "Invalid JSON");
  },
});

Deno.test({
  name: "parseToolCalls - JSON parse error includes the bad JSON",
  fn() {
    const response = `
TOOL_CALL
{"toolName": "read_file", "args": {"path": "test.ts"} /* comment */}
END_TOOL_CALL`;

    const result = parseToolCalls(response);
    assertEquals(result.calls.length, 0);
    assertEquals(result.errors.length, 1);
    assertEquals(result.errors[0].type, "json_parse");
    assertEquals(result.errors[0].json !== undefined, true);
    assertStringIncludes(result.errors[0].json!, "comment");
  },
});

// ============================================================
// Issue #2: Invalid Structure Error Reporting
// ============================================================

Deno.test({
  name: "parseToolCalls - invalid structure error for missing toolName",
  fn() {
    const response = `
TOOL_CALL
{"args": {"path": "test.ts"}}
END_TOOL_CALL`;

    const result = parseToolCalls(response);
    assertEquals(result.calls.length, 0);
    assertEquals(result.errors.length, 1);
    assertEquals(result.errors[0].type, "invalid_structure");
    assertStringIncludes(result.errors[0].message, "invalid structure");
  },
});

Deno.test({
  name: "parseToolCalls - invalid structure error for missing args",
  fn() {
    const response = `
TOOL_CALL
{"toolName": "read_file"}
END_TOOL_CALL`;

    const result = parseToolCalls(response);
    assertEquals(result.calls.length, 0);
    assertEquals(result.errors.length, 1);
    assertEquals(result.errors[0].type, "invalid_structure");
  },
});

Deno.test({
  name: "parseToolCalls - invalid structure error for wrong types",
  fn() {
    const response1 = `
TOOL_CALL
{"toolName": 123, "args": {}}
END_TOOL_CALL`;

    const result1 = parseToolCalls(response1);
    assertEquals(result1.calls.length, 0);
    assertEquals(result1.errors.length, 1);
    assertEquals(result1.errors[0].type, "invalid_structure");

    const response2 = `
TOOL_CALL
{"toolName": "read_file", "args": "not an object"}
END_TOOL_CALL`;

    const result2 = parseToolCalls(response2);
    assertEquals(result2.calls.length, 0);
    assertEquals(result2.errors.length, 1);
    assertEquals(result2.errors[0].type, "invalid_structure");
  },
});

// ============================================================
// Issue #3: Unclosed Block Detection
// ============================================================

Deno.test({
  name: "parseToolCalls - unclosed block error",
  fn() {
    const response = `Let me read this file.
TOOL_CALL
{"toolName": "read_file", "args": {"path": "test.ts"}}
Oops I forgot END_TOOL_CALL`;

    const result = parseToolCalls(response);
    assertEquals(result.calls.length, 0);
    assertEquals(result.errors.length, 1);
    assertEquals(result.errors[0].type, "unclosed_block");
    assertStringIncludes(result.errors[0].message, "not closed");
    assertEquals(result.errors[0].line, 2); // Line where TOOL_CALL started
  },
});

Deno.test({
  name: "parseToolCalls - unclosed block with partial JSON",
  fn() {
    const response = `
TOOL_CALL
{"toolName": "write_file",
`;

    const result = parseToolCalls(response);
    assertEquals(result.calls.length, 0);
    assertEquals(result.errors.length, 1);
    assertEquals(result.errors[0].type, "unclosed_block");
    assertEquals(result.errors[0].json !== undefined, true);
  },
});

// ============================================================
// Multiple Errors in One Response
// ============================================================

Deno.test({
  name: "parseToolCalls - multiple errors in one response",
  fn() {
    const response = `Let me try three tool calls.
TOOL_CALL
{invalid json 1}
END_TOOL_CALL

TOOL_CALL
{"toolName": "read_file"}
END_TOOL_CALL

TOOL_CALL
{"toolName": "search_code", "args": {"pattern": "test"}}
Never added END_TOOL_CALL!`;

    const result = parseToolCalls(response);
    assertEquals(result.calls.length, 0);
    assertEquals(result.errors.length, 3);
    assertEquals(result.errors[0].type, "json_parse");
    assertEquals(result.errors[1].type, "invalid_structure");
    assertEquals(result.errors[2].type, "unclosed_block");
  },
});

// ============================================================
// Mix of Valid Calls and Errors
// ============================================================

Deno.test({
  name: "parseToolCalls - mix of valid calls and errors",
  fn() {
    const response = `Let me do three things.
TOOL_CALL
{"toolName": "read_file", "args": {"path": "test.ts"}}
END_TOOL_CALL

TOOL_CALL
{invalid json}
END_TOOL_CALL

TOOL_CALL
{"toolName": "search_code", "args": {"pattern": "TODO"}}
END_TOOL_CALL`;

    const result = parseToolCalls(response);
    assertEquals(result.calls.length, 2); // Two valid calls
    assertEquals(result.errors.length, 1); // One error
    assertEquals(result.calls[0].toolName, "read_file");
    assertEquals(result.calls[1].toolName, "search_code");
    assertEquals(result.errors[0].type, "json_parse");
  },
});

Deno.test({
  name: "parseToolCalls - valid call then unclosed block",
  fn() {
    const response = `
TOOL_CALL
{"toolName": "list_files", "args": {"path": "src"}}
END_TOOL_CALL

TOOL_CALL
{"toolName": "read_file", "args": {"path": "test.ts"}}
`;

    const result = parseToolCalls(response);
    assertEquals(result.calls.length, 1); // First call valid
    assertEquals(result.errors.length, 1); // Second call unclosed
    assertEquals(result.calls[0].toolName, "list_files");
    assertEquals(result.errors[0].type, "unclosed_block");
  },
});

// ============================================================
// Edge Cases
// ============================================================

Deno.test({
  name: "parseToolCalls - empty JSON object is invalid structure",
  fn() {
    const response = `
TOOL_CALL
{}
END_TOOL_CALL`;

    const result = parseToolCalls(response);
    assertEquals(result.calls.length, 0);
    assertEquals(result.errors.length, 1);
    assertEquals(result.errors[0].type, "invalid_structure");
  },
});

Deno.test({
  name: "parseToolCalls - array instead of object is invalid structure",
  fn() {
    const response = `
TOOL_CALL
["read_file", {"path": "test.ts"}]
END_TOOL_CALL`;

    const result = parseToolCalls(response);
    assertEquals(result.calls.length, 0);
    assertEquals(result.errors.length, 1);
    assertEquals(result.errors[0].type, "invalid_structure");
  },
});

Deno.test({
  name: "parseToolCalls - null is invalid structure",
  fn() {
    const response = `
TOOL_CALL
null
END_TOOL_CALL`;

    const result = parseToolCalls(response);
    assertEquals(result.calls.length, 0);
    assertEquals(result.errors.length, 1);
    assertEquals(result.errors[0].type, "invalid_structure");
  },
});

// ============================================================
// Issue #8: Tool Call Count Limit Warning at Parse Time
// ============================================================

Deno.test({
  name: "parseToolCalls - too many calls generates error",
  fn() {
    // Generate 15 tool calls (limit is 10 by default)
    let response = "Let me do many things.\n";
    for (let i = 1; i <= 15; i++) {
      response += `TOOL_CALL\n{"toolName": "read_file", "args": {"path": "file${i}.ts"}}\nEND_TOOL_CALL\n\n`;
    }

    const result = parseToolCalls(response, 10);
    assertEquals(result.calls.length, 15); // All 15 parsed
    assertEquals(result.errors.length, 1); // One error about limit
    assertEquals(result.errors[0].type, "too_many_calls");
    assertStringIncludes(result.errors[0].message, "15 tool calls");
    assertStringIncludes(result.errors[0].message, "limit is 10");
  },
});

Deno.test({
  name: "parseToolCalls - custom limit respected",
  fn() {
    // Generate 8 tool calls with limit of 5
    let response = "";
    for (let i = 1; i <= 8; i++) {
      response += `TOOL_CALL\n{"toolName": "search_code", "args": {"pattern": "test${i}"}}\nEND_TOOL_CALL\n\n`;
    }

    const result = parseToolCalls(response, 5);
    assertEquals(result.calls.length, 8);
    assertEquals(result.errors.length, 1);
    assertEquals(result.errors[0].type, "too_many_calls");
    assertStringIncludes(result.errors[0].message, "8 tool calls");
    assertStringIncludes(result.errors[0].message, "limit is 5");
  },
});

Deno.test({
  name: "parseToolCalls - within limit no error",
  fn() {
    // Generate 10 tool calls (exactly at limit)
    let response = "";
    for (let i = 1; i <= 10; i++) {
      response += `TOOL_CALL\n{"toolName": "list_files", "args": {"path": "dir${i}"}}\nEND_TOOL_CALL\n\n`;
    }

    const result = parseToolCalls(response, 10);
    assertEquals(result.calls.length, 10);
    assertEquals(result.errors.length, 0); // No error when exactly at limit
  },
});
