/**
 * Meta Tools Tests
 *
 * Tests for ask_user and other meta tools
 */

import { assertEquals, assertRejects } from "jsr:@std/assert";
import { META_TOOLS } from "../../../src/hlvm/agent/tools/meta-tools.ts";

Deno.test({
  name: "META_TOOLS: ask_user - should be registered",
  fn() {
    assertEquals(META_TOOLS.ask_user !== undefined, true);
    assertEquals(typeof META_TOOLS.ask_user.fn, "function");
    assertEquals(
      META_TOOLS.ask_user.description.includes("Ask user"),
      true,
    );
  },
});

Deno.test({
  name: "META_TOOLS: ask_user - should have correct safety level",
  fn() {
    assertEquals(META_TOOLS.ask_user.safetyLevel, "L0");
  },
});

Deno.test({
  name: "META_TOOLS: ask_user - should have correct argument schema",
  fn() {
    assertEquals("question" in META_TOOLS.ask_user.args, true);
    assertEquals("options" in META_TOOLS.ask_user.args, true);
    assertEquals(
      META_TOOLS.ask_user.args.question.includes("string"),
      true,
    );
    assertEquals(
      META_TOOLS.ask_user.args.options.includes("optional"),
      true,
    );
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
