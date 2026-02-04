/**
 * Grounding validation tests
 */

import { assert, assertEquals, assertStringIncludes } from "jsr:@std/assert";
import { checkGrounding, type ToolUse } from "../../../src/hlvm/agent/grounding.ts";

Deno.test({
  name: "Grounding: no tools, no tool result -> grounded",
  fn() {
    const result = checkGrounding("Here is the answer.", []);
    assertEquals(result.grounded, true);
    assertEquals(result.warnings.length, 0);
  },
});

Deno.test({
  name: "Grounding: fabricated [Tool Result] -> warning",
  fn() {
    const result = checkGrounding(
      "[Tool Result] stdout: 4\nFinal: 4",
      [],
    );
    assertEquals(result.grounded, false);
    assert(result.warnings.length >= 1);
    assertStringIncludes(result.warnings[0], "[Tool Result]");
  },
});

Deno.test({
  name: "Grounding: Tool Result header -> warning",
  fn() {
    const result = checkGrounding(
      "Tool Result: stdout: 4\nFinal: 4",
      [],
    );
    assertEquals(result.grounded, false);
    assert(result.warnings.length >= 1);
    assertStringIncludes(result.warnings.join("\n"), "Tool Result");
  },
});

Deno.test({
  name: "Grounding: tool result mention in sentence -> grounded",
  fn() {
    const result = checkGrounding(
      "Based on the tool result from fetch_url, the page loads.",
      [],
    );
    assertEquals(result.grounded, true);
    assertEquals(result.warnings.length, 0);
  },
});

Deno.test({
  name: "Grounding: unknown tool mention -> warning",
  fn() {
    const result = checkGrounding(
      'Using the "html-parse" tool, I extracted the content.',
      [],
    );
    assertEquals(result.grounded, false);
    assert(result.warnings.length >= 1);
    assertStringIncludes(result.warnings.join("\n"), "unknown tool");
  },
});

Deno.test({
  name: "Grounding: tools used but not cited -> warning",
  fn() {
    const toolUses: ToolUse[] = [
      { toolName: "list_files", result: "file1\nfile2" },
    ];
    const result = checkGrounding("There are 2 files.", toolUses);
    assertEquals(result.grounded, false);
    assert(result.warnings.length >= 1);
  },
});

Deno.test({
  name: "Grounding: tools used and cited by name -> grounded",
  fn() {
    const toolUses: ToolUse[] = [
      { toolName: "list_files", result: "file1\nfile2" },
    ];
    const result = checkGrounding(
      "Based on list_files, there are 2 files.",
      toolUses,
    );
    assertEquals(result.grounded, true);
    assertEquals(result.warnings.length, 0);
  },
});

Deno.test({
  name: "Grounding: tools used and cited by normalized name -> grounded",
  fn() {
    const toolUses: ToolUse[] = [
      { toolName: "get_structure", result: "tree" },
    ];
    const result = checkGrounding(
      "According to get structure, here is the tree.",
      toolUses,
    );
    assertEquals(result.grounded, true);
    assertEquals(result.warnings.length, 0);
  },
});
