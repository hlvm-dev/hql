/**
 * Meta Tools Tests
 *
 * Tests for ask_user and other meta tools
 */

import { assertEquals, assertRejects } from "jsr:@std/assert";
import { META_TOOLS } from "../../../src/hlvm/agent/tools/meta-tools.ts";

Deno.test({
  name: "META_TOOLS: ask_user - should have correct safety level",
  fn() {
    assertEquals(META_TOOLS.ask_user.safetyLevel, "L0");
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
