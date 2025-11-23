// @ts-nocheck: Testing HQL package integration
// Test suite for @hql/math package

import { assertEquals } from "jsr:@std/assert@1";
import { run } from "./helpers.ts";

Deno.test("@hql/math - abs positive", async () => {
  const code = `
    (import [abs] from "@hql/math")
    (abs 5)
  `;
  const result = await run(code);
  assertEquals(result, 5);
});

Deno.test("@hql/math - abs negative", async () => {
  const code = `
    (import [abs] from "@hql/math")
    (abs -42)
  `;
  const result = await run(code);
  assertEquals(result, 42);
});

Deno.test("@hql/math - floor positive", async () => {
  const code = `
    (import [floor] from "@hql/math")
    (floor 3.7)
  `;
  const result = await run(code);
  assertEquals(result, 3);
});

Deno.test("@hql/math - floor negative", async () => {
  const code = `
    (import [floor] from "@hql/math")
    (floor -2.3)
  `;
  const result = await run(code);
  assertEquals(result, -3);
});

Deno.test("@hql/math - ceil positive", async () => {
  const code = `
    (import [ceil] from "@hql/math")
    (ceil 3.2)
  `;
  const result = await run(code);
  assertEquals(result, 4);
});

Deno.test("@hql/math - ceil negative", async () => {
  const code = `
    (import [ceil] from "@hql/math")
    (ceil -2.7)
  `;
  const result = await run(code);
  assertEquals(result, -2);
});

Deno.test("@hql/math - round up", async () => {
  const code = `
    (import [round] from "@hql/math")
    (round 3.7)
  `;
  const result = await run(code);
  assertEquals(result, 4);
});

Deno.test("@hql/math - round down", async () => {
  const code = `
    (import [round] from "@hql/math")
    (round 3.2)
  `;
  const result = await run(code);
  assertEquals(result, 3);
});

Deno.test("@hql/math - min with multiple args", async () => {
  const code = `
    (import [min] from "@hql/math")
    (min 5 2 8 1 9)
  `;
  const result = await run(code);
  assertEquals(result, 1);
});

Deno.test("@hql/math - min with negative", async () => {
  const code = `
    (import [min] from "@hql/math")
    (min -3 0 5 2)
  `;
  const result = await run(code);
  assertEquals(result, -3);
});

Deno.test("@hql/math - max with multiple args", async () => {
  const code = `
    (import [max] from "@hql/math")
    (max 5 2 8 1 9)
  `;
  const result = await run(code);
  assertEquals(result, 9);
});

Deno.test("@hql/math - max with negative", async () => {
  const code = `
    (import [max] from "@hql/math")
    (max -5 -2 -8 -1)
  `;
  const result = await run(code);
  assertEquals(result, -1);
});

Deno.test("@hql/math - multiple imports together", async () => {
  const code = `
    (import [abs, floor, ceil] from "@hql/math")
    (var a (abs -5))
    (var b (floor 3.7))
    (var c (ceil 2.1))
    [a b c]
  `;
  const result = await run(code);
  assertEquals(result, [5, 3, 3]);
});
