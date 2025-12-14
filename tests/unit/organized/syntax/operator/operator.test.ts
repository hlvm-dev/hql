// test/syntax-operators.test.ts
// Comprehensive tests for operators and primitives
// Covers arithmetic, comparison, logical operators and primitive types

import { assertEquals } from "https://deno.land/std@0.208.0/assert/mod.ts";
import { run } from "../../../helpers.ts";

// ============================================================================
// SECTION 1: ARITHMETIC OPERATORS
// ============================================================================

Deno.test("Operator: addition (+) with integers", async () => {
  const code = `(+ 10 20)`;
  const result = await run(code);
  assertEquals(result, 30);
});

Deno.test("Operator: addition (+) with floats", async () => {
  const code = `(+ 10.5 20.3)`;
  const result = await run(code);
  assertEquals(result, 30.8);
});

Deno.test("Operator: addition (+) with multiple operands", async () => {
  const code = `(+ 1 2 3 4 5)`;
  const result = await run(code);
  assertEquals(result, 15);
});

Deno.test("Operator: subtraction (-) with integers", async () => {
  const code = `(- 50 30)`;
  const result = await run(code);
  assertEquals(result, 20);
});

Deno.test("Operator: subtraction (-) with floats", async () => {
  const code = `(- 100.5 50.25)`;
  const result = await run(code);
  assertEquals(result, 50.25);
});

Deno.test("Operator: multiplication (*) with integers", async () => {
  const code = `(* 6 7)`;
  const result = await run(code);
  assertEquals(result, 42);
});

Deno.test("Operator: multiplication (*) with floats", async () => {
  const code = `(* 2.5 4.0)`;
  const result = await run(code);
  assertEquals(result, 10.0);
});

Deno.test("Operator: division (/) with integers", async () => {
  const code = `(/ 100 5)`;
  const result = await run(code);
  assertEquals(result, 20);
});

Deno.test("Operator: division (/) with floats", async () => {
  const code = `(/ 10.0 4.0)`;
  const result = await run(code);
  assertEquals(result, 2.5);
});

Deno.test("Operator: modulo (%) with integers", async () => {
  const code = `(% 17 5)`;
  const result = await run(code);
  assertEquals(result, 2);
});

Deno.test("Operator: nested arithmetic expressions", async () => {
  const code = `(+ (* 2 3) (- 10 5))`;
  const result = await run(code);
  assertEquals(result, 11); // (2*3) + (10-5) = 6 + 5 = 11
});

// ============================================================================
// SECTION 2: COMPARISON OPERATORS
// ============================================================================

Deno.test("Operator: less than (<) true case", async () => {
  const code = `(< 5 10)`;
  const result = await run(code);
  assertEquals(result, true);
});

Deno.test("Operator: less than (<) false case", async () => {
  const code = `(< 10 5)`;
  const result = await run(code);
  assertEquals(result, false);
});

Deno.test("Operator: greater than (>) true case", async () => {
  const code = `(> 10 5)`;
  const result = await run(code);
  assertEquals(result, true);
});

Deno.test("Operator: greater than (>) false case", async () => {
  const code = `(> 5 10)`;
  const result = await run(code);
  assertEquals(result, false);
});

Deno.test("Operator: less than or equal (<=) equal case", async () => {
  const code = `(<= 10 10)`;
  const result = await run(code);
  assertEquals(result, true);
});

Deno.test("Operator: less than or equal (<=) less case", async () => {
  const code = `(<= 5 10)`;
  const result = await run(code);
  assertEquals(result, true);
});

Deno.test("Operator: greater than or equal (>=) equal case", async () => {
  const code = `(>= 10 10)`;
  const result = await run(code);
  assertEquals(result, true);
});

Deno.test("Operator: greater than or equal (>=) greater case", async () => {
  const code = `(>= 15 10)`;
  const result = await run(code);
  assertEquals(result, true);
});

Deno.test("Operator: strict equality (===) with numbers", async () => {
  const code = `(=== 42 42)`;
  const result = await run(code);
  assertEquals(result, true);
});

Deno.test("Operator: strict equality (===) with strings", async () => {
  const code = `(=== "hello" "hello")`;
  const result = await run(code);
  assertEquals(result, true);
});

Deno.test("Operator: inequality (!=) true case", async () => {
  const code = `(!= 10 20)`;
  const result = await run(code);
  assertEquals(result, true);
});

Deno.test("Operator: inequality (!=) false case", async () => {
  const code = `(!= 10 10)`;
  const result = await run(code);
  assertEquals(result, false);
});

// ============================================================================
// SECTION 3: LOGICAL OPERATORS
// ============================================================================

Deno.test("Operator: logical and (and) both true", async () => {
  const code = `(and true true)`;
  const result = await run(code);
  assertEquals(result, true);
});

Deno.test("Operator: logical and (and) one false", async () => {
  const code = `(and true false)`;
  const result = await run(code);
  assertEquals(result, false);
});

Deno.test("Operator: logical and (and) both false", async () => {
  const code = `(and false false)`;
  const result = await run(code);
  assertEquals(result, false);
});

Deno.test("Operator: logical or (or) both true", async () => {
  const code = `(or true true)`;
  const result = await run(code);
  assertEquals(result, true);
});

Deno.test("Operator: logical or (or) one true", async () => {
  const code = `(or true false)`;
  const result = await run(code);
  assertEquals(result, true);
});

Deno.test("Operator: logical or (or) both false", async () => {
  const code = `(or false false)`;
  const result = await run(code);
  assertEquals(result, false);
});

Deno.test("Operator: logical not (not) with true", async () => {
  const code = `(not true)`;
  const result = await run(code);
  assertEquals(result, false);
});

Deno.test("Operator: logical not (not) with false", async () => {
  const code = `(not false)`;
  const result = await run(code);
  assertEquals(result, true);
});

// ============================================================================
// SECTION 4: PRIMITIVE TYPES
// ============================================================================

Deno.test("Primitive: integer number", async () => {
  const code = `42`;
  const result = await run(code);
  assertEquals(result, 42);
});

Deno.test("Primitive: floating point number", async () => {
  const code = `3.14159`;
  const result = await run(code);
  assertEquals(result, 3.14159);
});

Deno.test("Primitive: negative number", async () => {
  const code = `-42`;
  const result = await run(code);
  assertEquals(result, -42);
});

Deno.test("Primitive: string literal", async () => {
  const code = `"Hello, HQL!"`;
  const result = await run(code);
  assertEquals(result, "Hello, HQL!");
});

Deno.test("Primitive: empty string", async () => {
  const code = `""`;
  const result = await run(code);
  assertEquals(result, "");
});

Deno.test("Primitive: boolean true", async () => {
  const code = `true`;
  const result = await run(code);
  assertEquals(result, true);
});

Deno.test("Primitive: boolean false", async () => {
  const code = `false`;
  const result = await run(code);
  assertEquals(result, false);
});

Deno.test("Primitive: null value", async () => {
  const code = `null`;
  const result = await run(code);
  assertEquals(result, null);
});

Deno.test("Primitive: undefined value", async () => {
  const code = `undefined`;
  const result = await run(code);
  assertEquals(result, undefined);
});

// ============================================================================
// SECTION 5: STRING OPERATIONS
// ============================================================================

Deno.test("String: concatenation with +", async () => {
  const code = `(+ "Hello, " "World!")`;
  const result = await run(code);
  assertEquals(result, "Hello, World!");
});

Deno.test("String: length property access", async () => {
  const code = `
(var str "Hello")
str.length
`;
  const result = await run(code);
  assertEquals(result, 5);
});

Deno.test("String: charAt method", async () => {
  const code = `
(var str "Hello")
(str.charAt 1)
`;
  const result = await run(code);
  assertEquals(result, "e");
});

// ============================================================================
// SECTION 6: COMBINED EXPRESSIONS
// ============================================================================

Deno.test("Combined: arithmetic with comparison", async () => {
  const code = `(> (+ 10 20) 25)`;
  const result = await run(code);
  assertEquals(result, true);
});

Deno.test("Combined: comparison with logical operators", async () => {
  const code = `(and (> 10 5) (< 3 7))`;
  const result = await run(code);
  assertEquals(result, true);
});

Deno.test("Combined: complex nested expression", async () => {
  const code = `
(var x 10)
(var y 20)
(and (> x 5) (or (=== y 20) (< y 10)))
`;
  const result = await run(code);
  assertEquals(result, true);
});

Deno.test("Combined: arithmetic in variable assignment", async () => {
  const code = `
(var a 5)
(var b 10)
(var c (+ (* a 2) b))
c
`;
  const result = await run(code);
  assertEquals(result, 20); // (5*2) + 10 = 20
});

// ============================================================================
// SECTION 7: FIRST-CLASS OPERATORS
// Operators can be used as values (passed to HOFs, stored in variables, etc.)
// ============================================================================

Deno.test("First-class: reduce with + operator", async () => {
  const code = `(reduce + 0 [1 2 3 4 5])`;
  const result = await run(code);
  assertEquals(result, 15);
});

Deno.test("First-class: reduce with * operator", async () => {
  const code = `(reduce * 1 [1 2 3 4 5])`;
  const result = await run(code);
  assertEquals(result, 120);
});

Deno.test("First-class: reduce with - operator", async () => {
  const code = `(reduce - 100 [10 20 30])`;
  const result = await run(code);
  assertEquals(result, 40);
});

Deno.test("First-class: reduce with / operator", async () => {
  const code = `(reduce / 1000 [10 2])`;
  const result = await run(code);
  assertEquals(result, 50);
});

Deno.test("First-class: reduce with && operator", async () => {
  const code = `(reduce && true [true true false])`;
  const result = await run(code);
  assertEquals(result, false);
});

Deno.test("First-class: reduce with || operator", async () => {
  const code = `(reduce || false [false false true])`;
  const result = await run(code);
  assertEquals(result, true);
});

Deno.test("First-class: store operator in variable", async () => {
  const code = `
(let add-fn +)
(add-fn 10 20)
`;
  const result = await run(code);
  assertEquals(result, 30);
});

Deno.test("First-class: array of operators", async () => {
  const code = `
(let ops [+ - * /])
[((get ops 0) 10 5)
 ((get ops 1) 10 5)
 ((get ops 2) 10 5)
 ((get ops 3) 10 5)]
`;
  const result = await run(code);
  assertEquals(result, [15, 5, 50, 2]);
});

Deno.test("First-class: pass operator to custom function", async () => {
  const code = `
(fn apply-op [op a b]
  (op a b))
(apply-op * 6 7)
`;
  const result = await run(code);
  assertEquals(result, 42);
});

Deno.test("First-class: return operator from function", async () => {
  const code = `
(fn get-op [name]
  (cond
    ((=== name "add") +)
    ((=== name "mul") *)
    (else -)))
(let my-op (get-op "mul"))
(my-op 6 7)
`;
  const result = await run(code);
  assertEquals(result, 42);
});

Deno.test("First-class: operator in ternary", async () => {
  const code = `
(let op (? true + -))
(op 10 3)
`;
  const result = await run(code);
  assertEquals(result, 13);
});

Deno.test("First-class: map with operator array", async () => {
  const code = `(map (fn [op] (op 10 5)) [+ - * /])`;
  const result = await run(code);
  assertEquals(Array.from(result), [15, 5, 50, 2]);
});

Deno.test("First-class: bitwise operators in reduce", async () => {
  const code = `(reduce | 0 [1 2 4 8])`;
  const result = await run(code);
  assertEquals(result, 15); // 1|2|4|8 = 15
});

Deno.test("First-class: comparison operator stored", async () => {
  const code = `
(let cmp >)
(cmp 10 5)
`;
  const result = await run(code);
  assertEquals(result, true);
});

Deno.test("First-class: mixed normal and first-class usage", async () => {
  const code = `(+ 1 (reduce * 1 [2 3 4]))`;
  const result = await run(code);
  assertEquals(result, 25); // 1 + (2*3*4) = 1 + 24 = 25
});
