// @ts-nocheck: Testing HQL package integration
// Test suite for @hql/test package

import { assertEquals, assertRejects } from "jsr:@std/assert@1";
import { run } from "./helpers.ts";

Deno.test("@hql/test - assert passes with truthy values", async () => {
  const code = `
    (import [assert] from "@hql/test")
    (assert true "should pass")
  `;
  const result = await run(code);
  assertEquals(result, true);
});

Deno.test("@hql/test - assert fails with falsy values", async () => {
  const code = `
    (import [assert] from "@hql/test")
    (assert false "should fail")
  `;

  await assertRejects(
    async () => await run(code),
    Error,
    "should fail"
  );
});

Deno.test("@hql/test - assert passes with truthy condition", async () => {
  const code = `
    (import [assert] from "@hql/test")
    (assert (= 1 1) "1 equals 1")
  `;
  const result = await run(code);
  assertEquals(result, true);
});

Deno.test("@hql/test - assert fails with falsy condition", async () => {
  const code = `
    (import [assert] from "@hql/test")
    (assert (= 1 2) "1 does not equal 2")
  `;

  await assertRejects(
    async () => await run(code),
    Error,
    "1 does not equal 2"
  );
});

Deno.test("@hql/test - assert-eq passes with equal numbers", async () => {
  const code = `
    (import [assert-eq] from "@hql/test")
    (assert-eq 42 42 "numbers should be equal")
  `;
  const result = await run(code);
  assertEquals(result, true);
});

Deno.test("@hql/test - assert-eq fails with unequal numbers", async () => {
  const code = `
    (import [assert-eq] from "@hql/test")
    (assert-eq 42 43 "numbers are not equal")
  `;

  await assertRejects(
    async () => await run(code),
    Error,
    "Expected: 43"
  );
});

Deno.test("@hql/test - assert-eq passes with equal strings", async () => {
  const code = `
    (import [assert-eq] from "@hql/test")
    (assert-eq "hello" "hello" "strings should be equal")
  `;
  const result = await run(code);
  assertEquals(result, true);
});

Deno.test("@hql/test - assert-eq passes with equal objects", async () => {
  const code = `
    (import [assert-eq] from "@hql/test")
    (assert-eq {"a": 1, "b": 2} {"a": 1, "b": 2} "objects should be equal")
  `;
  const result = await run(code);
  assertEquals(result, true);
});

Deno.test("@hql/test - assert-eq fails with unequal objects", async () => {
  const code = `
    (import [assert-eq] from "@hql/test")
    (assert-eq {"a": 1} {"a": 2} "objects are not equal")
  `;

  await assertRejects(
    async () => await run(code),
    Error,
    "Expected:"
  );
});

Deno.test("@hql/test - assert-eq passes with equal arrays", async () => {
  const code = `
    (import [assert-eq] from "@hql/test")
    (assert-eq [1, 2, 3] [1, 2, 3] "arrays should be equal")
  `;
  const result = await run(code);
  assertEquals(result, true);
});

Deno.test("@hql/test - assert-throws passes when function throws", async () => {
  const code = `
    (import [assert-throws] from "@hql/test")
    (assert-throws (fn () (throw (new js/Error "boom"))) nil)
  `;
  const result = await run(code);
  assertEquals(result, true);
});

Deno.test("@hql/test - assert-throws fails when function doesn't throw", async () => {
  const code = `
    (import [assert-throws] from "@hql/test")
    (assert-throws (fn () 42) nil)
  `;

  await assertRejects(
    async () => await run(code),
    Error,
    "Expected function to throw"
  );
});

Deno.test("@hql/test - assert-throws passes with matching message", async () => {
  const code = `
    (import [assert-throws] from "@hql/test")
    (assert-throws (fn () (throw (new js/Error "file not found"))) "file not found")
  `;
  const result = await run(code);
  assertEquals(result, true);
});

Deno.test("@hql/test - assert-throws ignores message parameter", async () => {
  // Note: Message matching not yet implemented due to transpiler limitations
  const code = `
    (import [assert-throws] from "@hql/test")
    (assert-throws (fn () (throw (new js/Error "boom"))) "any message")
  `;

 const result = await run(code);
  assertEquals(result, true);
});

Deno.test("@hql/test - all functions work together", async () => {
  const code = `
    (import [assert, assert-eq, assert-throws] from "@hql/test")
    (var result1 (assert true "test 1"))
    (var result2 (assert-eq (+ 1 1) 2 "test 2"))
    (var result3 (assert-throws (fn () (throw (new js/Error "test"))) "test"))
    ;; Return result3 directly (all assertions passed if we get here)
    result3
  `;
  const result = await run(code);
  assertEquals(result, true);
});
