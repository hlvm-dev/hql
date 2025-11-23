import { assertEquals } from "https://deno.land/std@0.208.0/assert/mod.ts";
import { run } from "../helpers.ts";

Deno.test("v2.0: const binding", async () => {
  const code = `(const x 10) x`;
  const result = await run(code);
  assertEquals(result, 10);
});

Deno.test("v2.0: let binding (mutable)", async () => {
  const code = `(let x 10) (= x 20) x`;
  const result = await run(code);
  assertEquals(result, 20);
});

Deno.test("v2.0: assignment with =", async () => {
  const code = `(var x 10) (= x 20) x`;
  const result = await run(code);
  assertEquals(result, 20);
});

Deno.test("v2.0: strict equality ===", async () => {
  const code = `(=== 1 1)`;
  const result = await run(code);
  assertEquals(result, true);
});

Deno.test("v2.0: loose equality ==", async () => {
  const code = `(== 1 "1")`;
  const result = await run(code);
  assertEquals(result, true);
});

Deno.test("v2.0: strict inequality !==", async () => {
  const code = `(!== 1 2)`;
  const result = await run(code);
  assertEquals(result, true);
});

Deno.test("v2.0: logical AND", async () => {
  const code = `(&& true false)`;
  const result = await run(code);
  assertEquals(result, false);
});

Deno.test("v2.0: logical OR", async () => {
  const code = `(|| false true)`;
  const result = await run(code);
  assertEquals(result, true);
});

Deno.test("v2.0: logical NOT", async () => {
  const code = `(! false)`;
  const result = await run(code);
  assertEquals(result, true);
});

Deno.test("v2.0: nullish coalescing", async () => {
  const code = `(?? null 42)`;
  const result = await run(code);
  assertEquals(result, 42);
});

Deno.test("v2.0: bitwise AND", async () => {
  const code = `(& 5 3)`;
  const result = await run(code);
  assertEquals(result, 1);
});

Deno.test("v2.0: bitwise NOT", async () => {
  const code = `(~ 5)`;
  const result = await run(code);
  assertEquals(result, -6);
});

Deno.test("v2.0: typeof operator", async () => {
  const code = `(typeof 123)`;
  const result = await run(code);
  assertEquals(result, "number");
});

Deno.test("v2.0: exponentiation **", async () => {
  const code = `(** 2 3)`;
  const result = await run(code);
  assertEquals(result, 8);
});
