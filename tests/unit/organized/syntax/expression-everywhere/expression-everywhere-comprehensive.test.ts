/**
 * Core expression-everywhere coverage.
 *
 * The dedicated binding/function/class/enum suites already verify most syntax
 * semantics. This file keeps only the behaviors that are unique to
 * expression-everywhere itself: declarations evaluate to values and stay valid
 * when nested inside other expressions.
 */

import { assertEquals } from "jsr:@std/assert";
import { run } from "../../../helpers.ts";

Deno.test("Expr-everywhere: binding declarations evaluate to their bound value", async () => {
  assertEquals(await run("(let answer 42)"), 42);
  assertEquals(await run('(const greeting "hello")'), "hello");
  assertEquals(await run("(var counter 7)"), 7);
});

Deno.test("Expr-everywhere: named function declaration evaluates to a callable", async () => {
  const declared = await run("(fn double [x] (* x 2))");
  assertEquals(typeof declared, "function");
  assertEquals(
    await run(`
      (fn double [x] (* x 2))
      (double 21)
    `),
    42,
  );
});

Deno.test("Expr-everywhere: class declaration can be bound from expression position", async () => {
  const result = await run(`
    (let Point
      (class Point
        (constructor [x y]
          (= this.x x)
          (= this.y y))))
    (let point (new Point 3 4))
    (+ point.x point.y)
  `);
  assertEquals(result, 7);
});

Deno.test("Expr-everywhere: enum declaration can be bound from expression position", async () => {
  const result = await run(`
    (let Status
      (enum Status
        (case ready)
        (case done)))
    Status.ready
  `);
  assertEquals(result, "ready");
});

Deno.test("Expr-everywhere: declarations work inside function arguments and conditions", async () => {
  const result = await run(`
    (fn describe [value] (+ "status:" value))
    (if (let ready true)
      (describe (let state "ok"))
      "unreachable")
  `);
  assertEquals(result, "status:ok");
});

Deno.test("Expr-everywhere: declarations remain valid inside collection literals", async () => {
  const result = await run(`
    (let values [
      (let a 1)
      (let b 2)
      (let c 3)])
    (+ (get values 0) (get values 1) (get values 2))
  `);
  assertEquals(result, 6);
});
