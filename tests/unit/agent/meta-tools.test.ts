/**
 * Meta Tools Tests
 *
 * Tests for ask_user and other meta tools
 */

import { assertEquals, assertRejects } from "jsr:@std/assert";
import { META_TOOLS } from "../../../src/hlvm/agent/tools/meta-tools.ts";
import { searchTools } from "../../../src/hlvm/agent/registry.ts";
import type { TodoState } from "../../../src/hlvm/agent/todo-state.ts";

Deno.test({
  name: "META_TOOLS: ask_user - should have correct safety level",
  fn() {
    assertEquals(META_TOOLS.ask_user.safetyLevel, "L0");
    assertEquals(META_TOOLS.tool_search.safetyLevel, "L0");
    assertEquals(META_TOOLS.todo_read.safetyLevel, "L0");
    assertEquals(META_TOOLS.todo_write.safetyLevel, "L0");
  },
});

Deno.test({
  name: "META_TOOLS: ask_user - should reject invalid args",
  async fn() {
    await assertRejects(
      async () => await META_TOOLS.ask_user.fn(null, "/workspace"),
      Error,
      "args must be an object",
    );

    await assertRejects(
      async () => await META_TOOLS.ask_user.fn("not an object", "/workspace"),
      Error,
      "args must be an object",
    );
  },
});

Deno.test({
  name: "META_TOOLS: ask_user - should reject missing question",
  async fn() {
    await assertRejects(
      async () => await META_TOOLS.ask_user.fn({}, "/workspace"),
      Error,
      "question must be a non-empty string",
    );

    await assertRejects(
      async () =>
        await META_TOOLS.ask_user.fn({ question: "" }, "/workspace"),
      Error,
      "question must be a non-empty string",
    );
  },
});

Deno.test({
  name: "META_TOOLS: ask_user - should reject invalid options",
  async fn() {
    await assertRejects(
      async () =>
        await META_TOOLS.ask_user.fn(
          { question: "Test?", options: "not an array" },
          "/workspace",
        ),
      Error,
      "options must be an array",
    );

    await assertRejects(
      async () =>
        await META_TOOLS.ask_user.fn(
          { question: "Test?", options: [1, 2, 3] },
          "/workspace",
        ),
      Error,
      "all options must be strings",
    );
  },
});

Deno.test({
  name: "META_TOOLS: ask_user - abort signal should reject",
  async fn() {
    const controller = new AbortController();
    controller.abort();

    await assertRejects(
      async () =>
        await META_TOOLS.ask_user.fn(
          { question: "Test?" },
          "/workspace",
          { signal: controller.signal },
        ),
      Error,
      "aborted",
    );
  },
});

Deno.test({
  name: "META_TOOLS: tool_search - returns ranked matches and suggested allowlist",
  async fn() {
    const result = await META_TOOLS.tool_search.fn(
      { query: "read file", limit: 3 },
      "/workspace",
      { searchTools },
    ) as {
      count: number;
      matches: Array<{ name: string }>;
      suggested_allowlist: string[];
    };

    assertEquals(result.count > 0, true);
    assertEquals(Array.isArray(result.matches), true);
    assertEquals(result.matches[0].name, "read_file");
    assertEquals(
      result.suggested_allowlist.includes("read_file"),
      true,
    );
  },
});

Deno.test({
  name: "META_TOOLS: tool_search - triggers ensureMcpLoaded hook",
  async fn() {
    let ensured = false;
    await META_TOOLS.tool_search.fn(
      { query: "search code" },
      "/workspace",
      {
        ensureMcpLoaded: async () => {
          await Promise.resolve();
          ensured = true;
        },
        searchTools,
      },
    );
    assertEquals(ensured, true);
  },
});

Deno.test({
  name: "META_TOOLS: tool_search - rejects missing query",
  async fn() {
    await assertRejects(
      async () => await META_TOOLS.tool_search.fn({}, "/workspace"),
      Error,
      "query must be a non-empty string",
    );
  },
});

Deno.test({
  name: "META_TOOLS: todo_read/todo_write share session-scoped todo state",
  async fn() {
    const todoState: TodoState = { items: [] };
    const written = await META_TOOLS.todo_write.fn(
      {
        items: [
          { id: "step-1", content: "Inspect repo", status: "in_progress" },
          { id: "step-2", content: "Write tests", status: "pending" },
        ],
      },
      "/workspace",
      { todoState },
    ) as { items: Array<{ id: string; content: string; status: string }> };
    const read = await META_TOOLS.todo_read.fn({}, "/workspace", {
      todoState,
    }) as { items: Array<{ id: string; content: string; status: string }> };

    assertEquals(written.items.length, 2);
    assertEquals(read.items, written.items);
    assertEquals(todoState.items.length, 2);
    assertEquals(todoState.items[0]?.status, "in_progress");
  },
});

Deno.test({
  name: "META_TOOLS: todo_write rejects invalid item shapes",
  async fn() {
    await assertRejects(
      async () =>
        await META_TOOLS.todo_write.fn(
          { items: [{ id: "", content: "Bad", status: "pending" }] },
          "/workspace",
          { todoState: { items: [] } },
        ),
      Error,
      "items[0].id must be a non-empty string",
    );

    await assertRejects(
      async () =>
        await META_TOOLS.todo_write.fn(
          { items: [{ id: "ok", content: "", status: "pending" }] },
          "/workspace",
          { todoState: { items: [] } },
        ),
      Error,
      "items[0].content must be a non-empty string",
    );

    await assertRejects(
      async () =>
        await META_TOOLS.todo_write.fn(
          { items: [{ id: "ok", content: "Bad", status: "unknown" }] },
          "/workspace",
          { todoState: { items: [] } },
        ),
      Error,
      "items[0].status must be one of",
    );
  },
});
