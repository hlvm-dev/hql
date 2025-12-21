/**
 * Comprehensive Expression-Everywhere Tests
 *
 * Tests the core transpiler feature where declarations return values and can be
 * used ANYWHERE an expression is expected - both at top-level AND nested:
 *
 * TOP-LEVEL (declarations return values):
 * - (let x 10) returns 10
 * - (fn add ...) returns the function
 * - (class Point ...) returns the constructor
 * - (enum Color ...) returns the enum object
 *
 * NESTED (declarations as sub-expressions):
 * - (print (let x 99)) - let as function argument
 * - (if (let x true) ...) - let as condition
 * - (+ (let x 10) (let y 20)) - lets as arithmetic operands
 * - [(let a 1) (let b 2)] - lets in array literals
 *
 * Implementation uses variable hoisting: variables in expression positions are
 * collected and declared at block scope, then assignments are used as expressions.
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

// ============================================================================
// NESTED EXPRESSIONS - let/var as sub-expressions (TRUE expression-everywhere)
// ============================================================================

Deno.test("Nested expr: let as function argument", async () => {
  // (let x 99) inside print should bind x=99 and pass 99 to print
  const code = `
    (fn identity [x] x)
    (identity (let val 42))
  `;
  assertEquals(await run(code), 42);
});

Deno.test("Nested expr: let as condition in if", async () => {
  // (let x true) as condition should bind x=true and evaluate as truthy
  const code = `
    (if (let flag true) "yes" "no")
  `;
  assertEquals(await run(code), "yes");
});

Deno.test("Nested expr: let with false as condition", async () => {
  const code = `
    (if (let flag false) "yes" "no")
  `;
  assertEquals(await run(code), "no");
});

Deno.test("Nested expr: multiple lets as arithmetic operands", async () => {
  // Each let binds its variable and returns the value for the addition
  const code = `(+ (let a 10) (let b 20))`;
  assertEquals(await run(code), 30);
});

Deno.test("Nested expr: lets inside array literal", async () => {
  const code = `[(let x 1) (let y 2) (let z 3)]`;
  assertEquals(await run(code), [1, 2, 3]);
});

Deno.test("Nested expr: let in object value", async () => {
  const code = `
    (let obj { "value": (let v 42) })
    obj.value
  `;
  assertEquals(await run(code), 42);
});

Deno.test("Nested expr: multiple lets in object", async () => {
  const code = `
    (let obj { "a": (let x 1), "b": (let y 2), "c": (let z 3) })
    (+ obj.a obj.b obj.c)
  `;
  assertEquals(await run(code), 6);
});

Deno.test("Nested expr: var as function argument", async () => {
  const code = `
    (fn double [x] (* x 2))
    (double (var n 21))
  `;
  assertEquals(await run(code), 42);
});

Deno.test("Nested expr: chained lets in expression", async () => {
  // (let a 5) returns 5, (let b (+ a 5)) uses a=5, returns 10
  const code = `(* (let a 5) (let b (+ a 5)))`;
  assertEquals(await run(code), 50);  // 5 * 10 = 50
});

Deno.test("Nested expr: let in ternary branches", async () => {
  const code = `
    (if true
      (let x 100)
      (let y 200))
  `;
  assertEquals(await run(code), 100);
});

Deno.test("Nested expr: let in logical expression", async () => {
  const code = `(&& (let a true) (let b true))`;
  assertEquals(await run(code), true);
});

Deno.test("Nested expr: let in comparison", async () => {
  const code = `(> (let x 10) (let y 5))`;
  assertEquals(await run(code), true);
});

Deno.test("Nested expr: deeply nested lets", async () => {
  const code = `
    (+ (let a (+ (let b 1) (let c 2)))
       (let d (+ (let e 3) (let f 4))))
  `;
  // a = 1+2 = 3, d = 3+4 = 7, result = 3+7 = 10
  assertEquals(await run(code), 10);
});

Deno.test("Nested expr: let inside function body expression", async () => {
  const code = `
    (fn compute []
      (+ (let x 10) (let y 20)))
    (compute)
  `;
  assertEquals(await run(code), 30);
});

Deno.test("Nested expr: variable available after nested binding", async () => {
  // After (print (let x 99)), x should still be accessible
  const code = `
    (fn identity [v] v)
    (identity (let myVar 42))
    myVar
  `;
  assertEquals(await run(code), 42);
});

Deno.test("Nested expr: multiple variables bound in same expression", async () => {
  const code = `
    [(let first 1) (let second 2) (+ first second)]
  `;
  assertEquals(await run(code), [1, 2, 3]);
});

// ============================================================================
// CONST IN EXPRESSION POSITION
// ============================================================================

Deno.test("Nested expr: const as function argument", async () => {
  const code = `
    (fn identity [x] x)
    (identity (const val 42))
  `;
  assertEquals(await run(code), 42);
});

Deno.test("Nested expr: const in arithmetic", async () => {
  const code = `(+ (const a 10) (const b 20))`;
  assertEquals(await run(code), 30);
});

Deno.test("Nested expr: const in array literal", async () => {
  const code = `[(const x 1) (const y 2) (const z 3)]`;
  assertEquals(await run(code), [1, 2, 3]);
});

Deno.test("Nested expr: const as condition", async () => {
  const code = `(if (const flag true) "yes" "no")`;
  assertEquals(await run(code), "yes");
});

Deno.test("Nested expr: mixed let/const/var in expression", async () => {
  const code = `(+ (let a 1) (const b 2) (var c 3))`;
  assertEquals(await run(code), 6);
});

// ============================================================================
// DEEPLY NESTED EXPRESSIONS
// ============================================================================

Deno.test("Nested expr: 5 levels deep", async () => {
  const code = `
    (+ (let a (+ (let b (+ (let c (+ (let d (let e 1)) 2)) 3)) 4)) 5)
  `;
  // e=1, d=1, c=1+2=3, b=3+3=6, a=6+4=10, result=10+5=15
  assertEquals(await run(code), 15);
});

Deno.test("Nested expr: in template literal", async () => {
  const code = "`value is ${(let x 42)}`";
  assertEquals(await run(code), "value is 42");
});

Deno.test("Nested expr: in conditional branches", async () => {
  const code = `
    (+ (if true (let a 10) (let b 20))
       (if false (let c 30) (let d 40)))
  `;
  assertEquals(await run(code), 50);  // a=10, d=40, 10+40=50
});

Deno.test("Nested expr: let in while condition", async () => {
  // This tests that let works in loop conditions
  const code = `
    (let count 0)
    (while (< (let i count) 3)
      (= count (+ count 1)))
    count
  `;
  assertEquals(await run(code), 3);
});

Deno.test("Nested expr: let in method chain", async () => {
  const code = `
    ((let arr [1 2 3 4 5]).filter (fn [x] (> x 2)))
  `;
  assertEquals(await run(code), [3, 4, 5]);
});

Deno.test("Nested expr: let returning function", async () => {
  const code = `
    ((let f (fn [x] (* x 2))) 21)
  `;
  assertEquals(await run(code), 42);
});

Deno.test("Nested expr: var in nested function call", async () => {
  const code = `
    (fn outer [x] (fn inner [y] (+ x y)))
    ((outer (var a 10)) (var b 32))
  `;
  assertEquals(await run(code), 42);
});

// ============================================================================
// FN/CLASS/ENUM AS EXPRESSIONS (IIFE patterns)
// ============================================================================

Deno.test("Expr-everywhere: named fn as IIFE", async () => {
  // Named function immediately invoked
  const code = `((fn double [x] (* x 2)) 21)`;
  assertEquals(await run(code), 42);
});

Deno.test("Expr-everywhere: fn returning fn as IIFE", async () => {
  const code = `(((fn makeAdder [x] (fn [y] (+ x y))) 10) 5)`;
  assertEquals(await run(code), 15);
});

Deno.test("Expr-everywhere: class instantiated inline", async () => {
  const code = `
    (let p (new (class Point (constructor [x] (= this.x x))) 42))
    p.x
  `;
  assertEquals(await run(code), 42);
});

Deno.test("Expr-everywhere: enum assigned to variable", async () => {
  const code = `
    (let e (enum Color (case Red) (case Blue)))
    e.Red
  `;
  assertEquals(await run(code), "Red");
});

Deno.test("Expr-everywhere: fn in array", async () => {
  const code = `
    (let fns [(fn [x] (+ x 1)) (fn [x] (* x 2))])
    ((fns 0) 5)
  `;
  assertEquals(await run(code), 6);
});

Deno.test("Expr-everywhere: fn as argument to higher-order fn", async () => {
  const code = `
    (fn apply [f x] (f x))
    (apply (fn double [n] (* n 2)) 21)
  `;
  assertEquals(await run(code), 42);
});

Deno.test("Expr-everywhere: nested fn definitions", async () => {
  // Each fn returns the next fn, so we need to call each level
  const code = `
    (fn outer [] (fn middle [] (fn inner [] 42)))
    (let f (outer))
    (let g (f))
    (g)
  `;
  assertEquals(await run(code), 42);
});

// ============================================================================
// NESTED CALL EXPRESSIONS - ((expr)) calls the result of (expr)
// ============================================================================

Deno.test("Expr-everywhere: ((fn)) calls anonymous fn result", async () => {
  // ((fn [] 42)) should call the fn and return 42
  const code = `((fn [] 42))`;
  assertEquals(await run(code), 42);
});

Deno.test("Expr-everywhere: ((outer)) calls function returned by outer", async () => {
  // (outer) returns inner fn, ((outer)) calls that inner fn
  const code = `
    (let outer (fn [] (fn [] 123)))
    ((outer))
  `;
  assertEquals(await run(code), 123);
});

Deno.test("Expr-everywhere: (((f))) triple-nested call", async () => {
  // Three levels of function returns
  const code = `
    (let f (fn [] (fn [] (fn [] 999))))
    (((f)))
  `;
  assertEquals(await run(code), 999);
});

Deno.test("Expr-everywhere: ((outer) arg) passes arg to returned fn", async () => {
  // outer returns a fn that takes an arg
  const code = `
    (let outer (fn [] (fn [x] (* x 2))))
    ((outer) 21)
  `;
  assertEquals(await run(code), 42);
});

Deno.test("Expr-everywhere: ((fn returning fn) arg) with args at each level", async () => {
  // makeAdder(10) returns (fn [y] (+ 10 y)), then call with 5
  const code = `
    (let makeAdder (fn [x] (fn [y] (+ x y))))
    ((makeAdder 10) 5)
  `;
  assertEquals(await run(code), 15);
});

Deno.test("Expr-everywhere: member access on call result", async () => {
  // (getObj).a accesses property on returned object
  const code = `
    (let getObj (fn [] { "value": 42 }))
    ((getObj) .value)
  `;
  assertEquals(await run(code), 42);
});

// ============================================================================
// LET IN ARROW FUNCTION BODY - Tests hoisting in concise arrow bodies
// ============================================================================

Deno.test("Expr-everywhere: let in if inside arrow fn", async () => {
  // Arrow fn with let in conditional branches
  const code = `
    (let f (fn [x] (if x (let r 42) (let r 0))))
    (f true)
  `;
  assertEquals(await run(code), 42);
});

Deno.test("Expr-everywhere: let in and inside arrow fn", async () => {
  // and macro uses arrow functions internally
  const code = `(and (let x true) (let y 42))`;
  assertEquals(await run(code), 42);
});

Deno.test("Expr-everywhere: let in or inside arrow fn", async () => {
  // or macro uses arrow functions internally
  const code = `(or (let x false) (let y 99))`;
  assertEquals(await run(code), 99);
});

Deno.test("Expr-everywhere: multiple lets in arrow fn", async () => {
  // Multiple lets in a single arrow fn body
  const code = `
    (let f (fn [x] (+ (let a 1) (let b 2) x)))
    (f 10)
  `;
  assertEquals(await run(code), 13);
});

Deno.test("Expr-everywhere: nested lets in arrow fn branches", async () => {
  // Deeply nested lets in conditional branches
  const code = `
    (let f (fn [x] (if x
                       (if (let a true) (let b 100) (let c 0))
                       (let d 50))))
    (f true)
  `;
  assertEquals(await run(code), 100);
});
