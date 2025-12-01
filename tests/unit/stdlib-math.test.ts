// @ts-nocheck: Testing HQL package integration
// Test suite for math functions (using native JS interop)

import { assertEquals } from "jsr:@std/assert@1";
import { run } from "./helpers.ts";

Deno.test("math - abs positive", async () => {
  const code = `
    (js/Math.abs 5)
  `;
  const result = await run(code);
  assertEquals(result, 5);
});

Deno.test("math - abs negative", async () => {
  const code = `
    (js/Math.abs -42)
  `;
  const result = await run(code);
  assertEquals(result, 42);
});

Deno.test("math - floor positive", async () => {
  const code = `
    (js/Math.floor 3.7)
  `;
  const result = await run(code);
  assertEquals(result, 3);
});

Deno.test("math - floor negative", async () => {
  const code = `
    (js/Math.floor -2.3)
  `;
  const result = await run(code);
  assertEquals(result, -3);
});

Deno.test("math - ceil positive", async () => {
  const code = `
    (js/Math.ceil 3.2)
  `;
  const result = await run(code);
  assertEquals(result, 4);
});

Deno.test("math - ceil negative", async () => {
  const code = `
    (js/Math.ceil -2.7)
  `;
  const result = await run(code);
  assertEquals(result, -2);
});

Deno.test("math - round up", async () => {
  const code = `
    (js/Math.round 3.7)
  `;
  const result = await run(code);
  assertEquals(result, 4);
});

Deno.test("math - round down", async () => {
  const code = `
    (js/Math.round 3.2)
  `;
  const result = await run(code);
  assertEquals(result, 3);
});

Deno.test("math - min with multiple args", async () => {
  const code = `
    (js/Math.min 5 2 8 1 9)
  `;
  const result = await run(code);
  assertEquals(result, 1);
});

Deno.test("math - min with negative", async () => {
  const code = `
    (js/Math.min -3 0 5 2)
  `;
  const result = await run(code);
  assertEquals(result, -3);
});

Deno.test("math - max with multiple args", async () => {
  const code = `
    (js/Math.max 5 2 8 1 9)
  `;
  const result = await run(code);
  assertEquals(result, 9);
});

Deno.test("math - max with negative", async () => {
  const code = `
    (js/Math.max -5 -2 -8 -1)
  `;
  const result = await run(code);
  assertEquals(result, -1);
});

Deno.test("math - multiple operations", async () => {
  const code = `
    (var a (js/Math.abs -5))
    (var b (js/Math.floor 3.7))
    (var c (js/Math.ceil 2.1))
    [a b c]
  `;
  const result = await run(code);
  assertEquals(result, [5, 3, 3]);
});
