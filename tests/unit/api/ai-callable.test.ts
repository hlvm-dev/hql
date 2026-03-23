import { assertEquals, assertRejects } from "jsr:@std/assert@1";
import { ai, type AiApi } from "../../../src/hlvm/api/ai.ts";

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// ai() callable — type checks
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Deno.test("ai: is a callable function", () => {
  assertEquals(typeof ai, "function");
});

Deno.test("ai: has chat method", () => {
  assertEquals(typeof ai.chat, "function");
});

Deno.test("ai: has chatStructured method", () => {
  assertEquals(typeof ai.chatStructured, "function");
});

Deno.test("ai: has agent method", () => {
  assertEquals(typeof ai.agent, "function");
});

Deno.test("ai: has models.list method", () => {
  assertEquals(typeof ai.models.list, "function");
});

Deno.test("ai: has models.listAll method", () => {
  assertEquals(typeof ai.models.listAll, "function");
});

Deno.test("ai: has models.get method", () => {
  assertEquals(typeof ai.models.get, "function");
});

Deno.test("ai: has models.catalog method", () => {
  assertEquals(typeof ai.models.catalog, "function");
});

Deno.test("ai: has models.pull method", () => {
  assertEquals(typeof ai.models.pull, "function");
});

Deno.test("ai: has models.remove method", () => {
  assertEquals(typeof ai.models.remove, "function");
});

Deno.test("ai: has status method", () => {
  assertEquals(typeof ai.status, "function");
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// ai() callable — error handling
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Deno.test("ai: throws error for non-existent model", async () => {
  await assertRejects(
    () => ai("Hello", { model: "nonexistent-provider/no-such-model-xyz" }),
    Error,
  );
});
