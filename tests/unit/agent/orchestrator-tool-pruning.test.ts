/**
 * Phase-aware tool pruning tests.
 */

import { assertEquals } from "jsr:@std/assert";
import {
  buildPhaseAllowlist,
  inferConversationPhase,
} from "../../../src/hlvm/agent/orchestrator-tool-pruning.ts";

Deno.test("tool pruning: empty history infers explore phase", () => {
  assertEquals(inferConversationPhase([]), "explore");
});

Deno.test("tool pruning: write_file in window infers edit phase", () => {
  const history = ["read_file", "search_code", "write_file"];
  assertEquals(inferConversationPhase(history), "edit");
});

Deno.test("tool pruning: edit_file in window infers edit phase", () => {
  const history = ["read_file", "edit_file", "read_file"];
  assertEquals(inferConversationPhase(history), "edit");
});

Deno.test("tool pruning: shell_exec after edits infers validate phase", () => {
  const history = ["read_file", "edit_file", "shell_exec"];
  assertEquals(inferConversationPhase(history, "edit"), "validate");
});

Deno.test("tool pruning: complete_task infers finish phase", () => {
  const history = ["edit_file", "shell_exec", "complete_task"];
  assertEquals(inferConversationPhase(history, "validate"), "finish");
});

Deno.test("tool pruning: existing tool_search allowlist returns null (no override)", () => {
  const result = buildPhaseAllowlist("edit", ["read_file", "write_file"]);
  assertEquals(result, null);
});

Deno.test("tool pruning: explore phase excludes write tools", () => {
  const allowlist = buildPhaseAllowlist("explore");
  assertEquals(allowlist !== null, true);
  assertEquals(allowlist!.includes("write_file"), false);
  assertEquals(allowlist!.includes("edit_file"), false);
  assertEquals(allowlist!.includes("read_file"), true);
  assertEquals(allowlist!.includes("search_code"), true);
});

Deno.test("tool pruning: edit phase includes write tools and undo_edit", () => {
  const allowlist = buildPhaseAllowlist("edit");
  assertEquals(allowlist !== null, true);
  assertEquals(allowlist!.includes("write_file"), true);
  assertEquals(allowlist!.includes("edit_file"), true);
  assertEquals(allowlist!.includes("undo_edit"), true);
  assertEquals(allowlist!.includes("read_file"), true);
});

Deno.test("tool pruning: finish phase returns null (no pruning)", () => {
  assertEquals(buildPhaseAllowlist("finish"), null);
});
