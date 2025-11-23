/**
 * COMPREHENSIVE V2.0 OPERATOR TEST SUITE
 * Tests EVERY operator from MIGRATION_V2.md specification
 *
 * This file tests ALL 34 v2.0 operators to ensure 100% compliance
 */

import { assertEquals } from "https://deno.land/std@0.208.0/assert/mod.ts";
import { run } from "../helpers.ts";

// ============================================================================
// ASSIGNMENT OPERATORS (1)
// ============================================================================

Deno.test("v2.0 Comprehensive: = assignment", async () => {
  const code = `(var x 10) (= x 20) x`;
  const result = await run(code);
  assertEquals(result, 20);
});

// ============================================================================
// EQUALITY OPERATORS (4)
// ============================================================================

Deno.test("v2.0 Comprehensive: === strict equality (true)", async () => {
  const code = `(=== 1 1)`;
  const result = await run(code);
  assertEquals(result, true);
});

Deno.test("v2.0 Comprehensive: === strict equality (false)", async () => {
  const code = `(=== 1 2)`;
  const result = await run(code);
  assertEquals(result, false);
});

Deno.test("v2.0 Comprehensive: === type check", async () => {
  const code = `(=== 1 "1")`;
  const result = await run(code);
  assertEquals(result, false);
});

Deno.test("v2.0 Comprehensive: == loose equality", async () => {
  const code = `(== 1 "1")`;
  const result = await run(code);
  assertEquals(result, true);
});

Deno.test("v2.0 Comprehensive: !== strict inequality", async () => {
  const code = `(!== 1 2)`;
  const result = await run(code);
  assertEquals(result, true);
});

Deno.test("v2.0 Comprehensive: != loose inequality", async () => {
  const code = `(!= 1 2)`;
  const result = await run(code);
  assertEquals(result, true);
});

// ============================================================================
// RELATIONAL OPERATORS (4)
// ============================================================================

Deno.test("v2.0 Comprehensive: > greater than", async () => {
  const code = `(> 5 3)`;
  const result = await run(code);
  assertEquals(result, true);
});

Deno.test("v2.0 Comprehensive: >= greater or equal", async () => {
  const code = `(>= 5 5)`;
  const result = await run(code);
  assertEquals(result, true);
});

Deno.test("v2.0 Comprehensive: < less than", async () => {
  const code = `(< 3 5)`;
  const result = await run(code);
  assertEquals(result, true);
});

Deno.test("v2.0 Comprehensive: <= less or equal", async () => {
  const code = `(<= 5 5)`;
  const result = await run(code);
  assertEquals(result, true);
});

// ============================================================================
// LOGICAL OPERATORS (4)
// ============================================================================

Deno.test("v2.0 Comprehensive: && logical AND (true)", async () => {
  const code = `(&& true true)`;
  const result = await run(code);
  assertEquals(result, true);
});

Deno.test("v2.0 Comprehensive: && logical AND (false)", async () => {
  const code = `(&& true false)`;
  const result = await run(code);
  assertEquals(result, false);
});

Deno.test("v2.0 Comprehensive: || logical OR (true)", async () => {
  const code = `(|| false true)`;
  const result = await run(code);
  assertEquals(result, true);
});

Deno.test("v2.0 Comprehensive: || logical OR (false)", async () => {
  const code = `(|| false false)`;
  const result = await run(code);
  assertEquals(result, false);
});

Deno.test("v2.0 Comprehensive: ! logical NOT", async () => {
  const code = `(! false)`;
  const result = await run(code);
  assertEquals(result, true);
});

Deno.test("v2.0 Comprehensive: ?? nullish coalescing (null)", async () => {
  const code = `(?? null 42)`;
  const result = await run(code);
  assertEquals(result, 42);
});

Deno.test("v2.0 Comprehensive: ?? nullish coalescing (value)", async () => {
  const code = `(?? 10 42)`;
  const result = await run(code);
  assertEquals(result, 10);
});

// ============================================================================
// BITWISE OPERATORS (7)
// ============================================================================

Deno.test("v2.0 Comprehensive: & bitwise AND", async () => {
  const code = `(& 5 3)`;
  const result = await run(code);
  assertEquals(result, 1);
});

Deno.test("v2.0 Comprehensive: | bitwise OR", async () => {
  const code = `(| 5 3)`;
  const result = await run(code);
  assertEquals(result, 7);
});

Deno.test("v2.0 Comprehensive: ^ bitwise XOR", async () => {
  const code = `(^ 5 3)`;
  const result = await run(code);
  assertEquals(result, 6);
});

Deno.test("v2.0 Comprehensive: ~ bitwise NOT", async () => {
  const code = `(~ 5)`;
  const result = await run(code);
  assertEquals(result, -6);
});

Deno.test("v2.0 Comprehensive: << left shift", async () => {
  const code = `(<< 5 2)`;
  const result = await run(code);
  assertEquals(result, 20);
});

Deno.test("v2.0 Comprehensive: >> right shift (sign-propagating)", async () => {
  const code = `(>> 20 2)`;
  const result = await run(code);
  assertEquals(result, 5);
});

Deno.test("v2.0 Comprehensive: >>> unsigned right shift", async () => {
  const code = `(>>> 20 2)`;
  const result = await run(code);
  assertEquals(result, 5);
});

// ============================================================================
// TYPE OPERATORS (5)
// ============================================================================

Deno.test("v2.0 Comprehensive: typeof number", async () => {
  const code = `(typeof 123)`;
  const result = await run(code);
  assertEquals(result, "number");
});

Deno.test("v2.0 Comprehensive: typeof string", async () => {
  const code = `(typeof "hello")`;
  const result = await run(code);
  assertEquals(result, "string");
});

Deno.test("v2.0 Comprehensive: instanceof", async () => {
  const code = `(var arr [1 2]) (instanceof arr js/Array)`;
  const result = await run(code);
  assertEquals(result, true);
});

Deno.test("v2.0 Comprehensive: in operator", async () => {
  const code = `(var obj {"x": 10}) (in "x" obj)`;
  const result = await run(code);
  assertEquals(result, true);
});

Deno.test("v2.0 Comprehensive: delete operator", async () => {
  // NOTE: This test will FAIL until delete operator is fixed
  const code = `(var obj {"x": 10}) (delete obj.x) (in "x" obj)`;
  const result = await run(code);
  assertEquals(result, false, "Property should be deleted");
});

Deno.test("v2.0 Comprehensive: void operator", async () => {
  const code = `(void 42)`;
  const result = await run(code);
  assertEquals(result, undefined);
});

// ============================================================================
// ARITHMETIC OPERATORS (6)
// ============================================================================

Deno.test("v2.0 Comprehensive: + addition", async () => {
  const code = `(+ 10 20)`;
  const result = await run(code);
  assertEquals(result, 30);
});

Deno.test("v2.0 Comprehensive: - subtraction", async () => {
  const code = `(- 20 10)`;
  const result = await run(code);
  assertEquals(result, 10);
});

Deno.test("v2.0 Comprehensive: * multiplication", async () => {
  const code = `(* 6 7)`;
  const result = await run(code);
  assertEquals(result, 42);
});

Deno.test("v2.0 Comprehensive: / division", async () => {
  const code = `(/ 20 4)`;
  const result = await run(code);
  assertEquals(result, 5);
});

Deno.test("v2.0 Comprehensive: % modulo", async () => {
  const code = `(% 17 5)`;
  const result = await run(code);
  assertEquals(result, 2);
});

Deno.test("v2.0 Comprehensive: ** exponentiation", async () => {
  const code = `(** 2 3)`;
  const result = await run(code);
  assertEquals(result, 8);
});

// ============================================================================
// BINDING FORMS (3)
// ============================================================================

Deno.test("v2.0 Comprehensive: const binding", async () => {
  const code = `(const x 10) x`;
  const result = await run(code);
  assertEquals(result, 10);
});

Deno.test("v2.0 Comprehensive: let binding", async () => {
  const code = `(let x 10) (= x 20) x`;
  const result = await run(code);
  assertEquals(result, 20);
});

Deno.test("v2.0 Comprehensive: var binding", async () => {
  const code = `(var x 10) (= x 20) x`;
  const result = await run(code);
  assertEquals(result, 20);
});

// ============================================================================
// SUMMARY: 34 operators tested
// ============================================================================
// Assignment: 1
// Equality: 4
// Relational: 4
// Logical: 4
// Bitwise: 7
// Type: 5
// Arithmetic: 6
// Binding: 3
// TOTAL: 34 operators
// ============================================================================
