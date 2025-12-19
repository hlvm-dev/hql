/**
 * Comprehensive Expression-Everywhere Tests
 *
 * Tests the core transpiler feature where TOP-LEVEL declarations return values:
 * - (let x 10) returns 10
 * - (fn add ...) returns the function
 * - (class Point ...) returns the constructor
 * - (enum Color ...) returns the enum object
 *
 * NOTE: Expression-everywhere applies to TOP-LEVEL declarations only.
 * Using (let x 10) as a sub-expression inside other forms is NOT supported.
 */

import { assertEquals, assertNotEquals } from "https://deno.land/std@0.208.0/assert/mod.ts";
import { run } from "../../../helpers.ts";

// ============================================================================
// BINDING EXPRESSIONS - Return the bound value
// ============================================================================

Deno.test("Expr-everywhere: let with number returns number", async () => {
  assertEquals(await run("(let x 42)"), 42);
});

Deno.test("Expr-everywhere: let with string returns string", async () => {
  assertEquals(await run('(let s "hello")'), "hello");
});

Deno.test("Expr-everywhere: let with boolean true", async () => {
  assertEquals(await run("(let flag true)"), true);
});

Deno.test("Expr-everywhere: let with boolean false", async () => {
  assertEquals(await run("(let flag false)"), false);
});

Deno.test("Expr-everywhere: let with null returns null", async () => {
  assertEquals(await run("(let n null)"), null);
});

Deno.test("Expr-everywhere: let with undefined returns undefined", async () => {
  assertEquals(await run("(let u undefined)"), undefined);
});

Deno.test("Expr-everywhere: let with array returns array", async () => {
  assertEquals(await run("(let arr [1 2 3])"), [1, 2, 3]);
});

Deno.test("Expr-everywhere: let with computed value returns result", async () => {
  assertEquals(await run("(let sum (+ 10 20 30))"), 60);
});

Deno.test("Expr-everywhere: const returns value", async () => {
  assertEquals(await run("(const PI 3.14159)"), 3.14159);
});

Deno.test("Expr-everywhere: var returns value", async () => {
  assertEquals(await run("(var counter 100)"), 100);
});

Deno.test("Expr-everywhere: let with function call returns call result", async () => {
  const code = `
    (fn double [x] (* x 2))
    (let result (double 21))
  `;
  assertEquals(await run(code), 42);
});

Deno.test("Expr-everywhere: let with negative number", async () => {
  assertEquals(await run("(let neg -42)"), -42);
});

Deno.test("Expr-everywhere: let with float", async () => {
  assertEquals(await run("(let pi 3.14159)"), 3.14159);
});

Deno.test("Expr-everywhere: let with empty array", async () => {
  assertEquals(await run("(let empty [])"), []);
});

// ============================================================================
// FUNCTION EXPRESSIONS - Return the function itself
// ============================================================================

Deno.test("Expr-everywhere: fn type is function", async () => {
  const code = `
    (fn greet [name] (str "Hi " name))
    (typeof greet)
  `;
  assertEquals(await run(code), "function");
});

Deno.test("Expr-everywhere: fn can be called immediately", async () => {
  const code = `
    (fn square [x] (* x x))
    (square 7)
  `;
  assertEquals(await run(code), 49);
});

Deno.test("Expr-everywhere: fn assigned to variable is same function", async () => {
  const code = `
    (fn original [x] x)
    (let alias original)
    (=== alias original)
  `;
  assertEquals(await run(code), true);
});

Deno.test("Expr-everywhere: fn with closure works", async () => {
  const code = `
    (let multiplier 10)
    (fn multiply [x] (* x multiplier))
    (multiply 5)
  `;
  assertEquals(await run(code), 50);
});

Deno.test("Expr-everywhere: recursive fn works", async () => {
  const code = `
    (fn fib [n]
      (if (<= n 1) n
        (+ (fib (- n 1)) (fib (- n 2)))))
    (fib 10)
  `;
  assertEquals(await run(code), 55);
});

Deno.test("Expr-everywhere: higher-order fn works", async () => {
  const code = `
    (fn makeAdder [x]
      (fn [y] (+ x y)))
    (let add5 (makeAdder 5))
    (add5 10)
  `;
  assertEquals(await run(code), 15);
});

Deno.test("Expr-everywhere: fn as argument works", async () => {
  const code = `
    (fn apply [f x] (f x))
    (fn double [n] (* n 2))
    (apply double 21)
  `;
  assertEquals(await run(code), 42);
});

Deno.test("Expr-everywhere: fn with default param", async () => {
  const code = `
    (fn greet [name = "World"]
      (str "Hello, " name))
    (greet)
  `;
  assertEquals(await run(code), "Hello, World");
});

Deno.test("Expr-everywhere: fn with rest params", async () => {
  const code = `
    (fn sum [& nums]
      (nums.reduce (fn [a b] (+ a b)) 0))
    (sum 1 2 3 4 5)
  `;
  assertEquals(await run(code), 15);
});

Deno.test("Expr-everywhere: fn returns correct value", async () => {
  const code = `
    (fn add [a b] (+ a b))
    (add 3 4)
  `;
  assertEquals(await run(code), 7);
});

// ============================================================================
// CLASS EXPRESSIONS - Return the constructor
// ============================================================================

Deno.test("Expr-everywhere: class returns constructor function", async () => {
  const code = `
    (class Empty)
    (typeof Empty)
  `;
  assertEquals(await run(code), "function");
});

Deno.test("Expr-everywhere: class can be instantiated", async () => {
  const code = `
    (class Point
      (constructor [x y]
        (= this.x x)
        (= this.y y)))
    (let p (new Point 3 4))
    (+ p.x p.y)
  `;
  assertEquals(await run(code), 7);
});

Deno.test("Expr-everywhere: class with method", async () => {
  const code = `
    (class Counter
      (constructor []
        (= this.count 0))
      (fn increment []
        (= this.count (+ this.count 1))
        this.count))
    (let c (new Counter))
    (c.increment)
    (c.increment)
  `;
  assertEquals(await run(code), 2);
});

Deno.test("Expr-everywhere: class stored in variable", async () => {
  const code = `
    (class Original)
    (let Alias Original)
    (=== Alias Original)
  `;
  assertEquals(await run(code), true);
});

// ============================================================================
// ENUM EXPRESSIONS - Return the enum object
// ============================================================================

Deno.test("Expr-everywhere: enum returns object", async () => {
  const code = `
    (enum Direction
      (case North)
      (case South))
    (typeof Direction)
  `;
  assertEquals(await run(code), "object");
});

Deno.test("Expr-everywhere: enum values accessible", async () => {
  const code = `
    (enum Status
      (case Pending)
      (case Active)
      (case Done))
    Status.Active
  `;
  assertEquals(await run(code), "Active");
});

Deno.test("Expr-everywhere: enum stored in variable", async () => {
  const code = `
    (enum Color
      (case Red)
      (case Green))
    (let Colors Color)
    Colors.Red
  `;
  assertEquals(await run(code), "Red");
});

// ============================================================================
// SEQUENTIAL DECLARATIONS - Each returns its value
// ============================================================================

Deno.test("Expr-everywhere: sequential lets, last value returned", async () => {
  const code = `
    (let a 1)
    (let b 2)
    (let c 3)
    c
  `;
  assertEquals(await run(code), 3);
});

Deno.test("Expr-everywhere: sequential lets can reference each other", async () => {
  const code = `
    (let x 10)
    (let y (+ x 5))
    (let z (+ y 5))
    z
  `;
  assertEquals(await run(code), 20);
});

Deno.test("Expr-everywhere: fn then let uses fn", async () => {
  const code = `
    (fn double [x] (* x 2))
    (let result (double 21))
    result
  `;
  assertEquals(await run(code), 42);
});

Deno.test("Expr-everywhere: let then fn uses let", async () => {
  const code = `
    (let factor 10)
    (fn scale [x] (* x factor))
    (scale 5)
  `;
  assertEquals(await run(code), 50);
});

Deno.test("Expr-everywhere: class then let instantiates", async () => {
  const code = `
    (class Box
      (constructor [v] (= this.value v)))
    (let b (new Box 42))
    b.value
  `;
  assertEquals(await run(code), 42);
});

// ============================================================================
// NESTED SCOPES
// ============================================================================

Deno.test("Expr-everywhere: let in function body", async () => {
  const code = `
    (fn compute []
      (let temp 100)
      (* temp 2))
    (compute)
  `;
  assertEquals(await run(code), 200);
});

Deno.test("Expr-everywhere: multiple lets in function body", async () => {
  const code = `
    (fn calc []
      (let a 10)
      (let b 20)
      (+ a b))
    (calc)
  `;
  assertEquals(await run(code), 30);
});

Deno.test("Expr-everywhere: let with body (binding form)", async () => {
  const code = `
    (let (x 10 y 20)
      (+ x y))
  `;
  assertEquals(await run(code), 30);
});

Deno.test("Expr-everywhere: nested let with body", async () => {
  const code = `
    (let (x 10)
      (let (y 20)
        (+ x y)))
  `;
  assertEquals(await run(code), 30);
});

Deno.test("Expr-everywhere: fn inside fn", async () => {
  const code = `
    (fn outer []
      (fn inner [] 42))
    (let f (outer))
    (f)
  `;
  assertEquals(await run(code), 42);
});

// ============================================================================
// SHADOWING
// ============================================================================

Deno.test("Expr-everywhere: shadowing in inner scope", async () => {
  const code = `
    (let x 10)
    (let (x 20)
      x)
  `;
  assertEquals(await run(code), 20);
});

Deno.test("Expr-everywhere: outer preserved after shadow", async () => {
  const code = `
    (let x 10)
    (let (x 20)
      x)
    x
  `;
  assertEquals(await run(code), 10);
});

// ============================================================================
// EDGE CASES
// ============================================================================

Deno.test("Expr-everywhere: many sequential bindings", async () => {
  const code = `
    (let a 1)
    (let b 2)
    (let c 3)
    (let d 4)
    (let e 5)
    (+ a b c d e)
  `;
  assertEquals(await run(code), 15);
});

Deno.test("Expr-everywhere: binding with complex expression", async () => {
  const code = `
    (let result (if (> 10 5) (* 2 (+ 3 4)) 0))
    result
  `;
  assertEquals(await run(code), 14);
});

Deno.test("Expr-everywhere: binding anonymous function", async () => {
  const code = `
    (let f (fn [x] (+ x 1)))
    (f 41)
  `;
  assertEquals(await run(code), 42);
});

// ============================================================================
// VERIFY RETURN VALUES ARE NOT UNDEFINED
// ============================================================================

Deno.test("Expr-everywhere: let returns value not undefined", async () => {
  const result = await run("(let x 42)");
  assertNotEquals(result, undefined);
  assertEquals(result, 42);
});

Deno.test("Expr-everywhere: const returns value not undefined", async () => {
  const result = await run("(const X 99)");
  assertNotEquals(result, undefined);
  assertEquals(result, 99);
});

Deno.test("Expr-everywhere: var returns value not undefined", async () => {
  const result = await run("(var v 77)");
  assertNotEquals(result, undefined);
  assertEquals(result, 77);
});

// ============================================================================
// INTEGRATION WITH STANDARD LIBRARY
// ============================================================================

Deno.test("Expr-everywhere: with map", async () => {
  const code = `
    (let nums [1 2 3 4 5])
    (let doubled (nums.map (fn [x] (* x 2))))
    doubled
  `;
  assertEquals(await run(code), [2, 4, 6, 8, 10]);
});

Deno.test("Expr-everywhere: with filter", async () => {
  const code = `
    (let nums [1 2 3 4 5 6])
    (let evens (nums.filter (fn [x] (=== (% x 2) 0))))
    evens
  `;
  assertEquals(await run(code), [2, 4, 6]);
});

Deno.test("Expr-everywhere: with reduce", async () => {
  const code = `
    (let nums [1 2 3 4 5])
    (let sum (nums.reduce (fn [acc x] (+ acc x)) 0))
    sum
  `;
  assertEquals(await run(code), 15);
});
