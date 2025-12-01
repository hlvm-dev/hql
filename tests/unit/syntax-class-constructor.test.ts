// tests/test/syntax-class-constructor.test.ts
// Tests for class constructor parameters (verifying no shifting bugs)

import { assertEquals } from "jsr:@std/assert@1";
import { run } from "./helpers.ts";

Deno.test("Class: constructor parameters are correct", async () => {
  const code = `
    (class Point
      (constructor (x y)
        (= this.x x)
        (= this.y y)))
    
    (let p (new Point 10 20))
    [p.x p.y]
  `;
  const result = await run(code);
  assertEquals(result, [10, 20]);
});

Deno.test("Class: constructor with no params", async () => {
  const code = `
    (class Empty
      (constructor ()
        (= this.val 42)))
    
    (let e (new Empty))
    e.val
  `;
  const result = await run(code);
  assertEquals(result, 42);
});

Deno.test("Class: constructor with vector literal syntax", async () => {
  const code = `
    (class VectorPoint
      (constructor [x y]
        (= this.x x)
        (= this.y y)))
    
    (let p (new VectorPoint 30 40))
    [p.x p.y]
  `;
  const result = await run(code);
  assertEquals(result, [30, 40]);
});