import { assertEquals } from "https://deno.land/std/assert/mod.ts";
import { classifyInput } from "../../../src/hlvm/tui-v2/input/InputDispatch.ts";

Deno.test("chat mode: plain text → conversation", () => {
  assertEquals(classifyInput("hello world", "chat"), { kind: "conversation" });
});

Deno.test("chat mode: /model → command with no args", () => {
  assertEquals(classifyInput("/model", "chat"), { kind: "command", name: "model", args: "" });
});

Deno.test("chat mode: /model claude-sonnet → command with args", () => {
  assertEquals(classifyInput("/model claude-sonnet", "chat"), { kind: "command", name: "model", args: "claude-sonnet" });
});

Deno.test("chat mode: !ls -la → shell", () => {
  assertEquals(classifyInput("!ls -la", "chat"), { kind: "shell", command: "ls -la" });
});

Deno.test("chat mode: (+ 1 2) → hql_eval", () => {
  assertEquals(classifyInput("(+ 1 2)", "chat"), { kind: "hql_eval" });
});

Deno.test("chat mode: (map inc [1 2 3]) → hql_eval", () => {
  assertEquals(classifyInput("(map inc [1 2 3])", "chat"), { kind: "hql_eval" });
});

Deno.test("chat mode: unbalanced (hello → conversation", () => {
  assertEquals(classifyInput("(hello", "chat"), { kind: "conversation" });
});

Deno.test("chat mode: explain (get data 1) → conversation (no leading paren)", () => {
  assertEquals(classifyInput("explain (get data 1)", "chat"), { kind: "conversation" });
});

Deno.test("chat mode: empty and whitespace → noop", () => {
  assertEquals(classifyInput("", "chat"), { kind: "noop" });
  assertEquals(classifyInput("   ", "chat"), { kind: "noop" });
});

Deno.test("code mode: (+ 1 2) → hql_eval", () => {
  assertEquals(classifyInput("(+ 1 2)", "code"), { kind: "hql_eval" });
});

Deno.test("code mode: let x = 5 → js_eval", () => {
  assertEquals(classifyInput("let x = 5", "code"), { kind: "js_eval" });
});

Deno.test("code mode: /help → command", () => {
  assertEquals(classifyInput("/help", "code"), { kind: "command", name: "help", args: "" });
});

Deno.test("code mode: !pwd → shell", () => {
  assertEquals(classifyInput("!pwd", "code"), { kind: "shell", command: "pwd" });
});
