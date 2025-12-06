// tests/unit/interpreter/interpreter.test.ts
// Tests for the HQL macro-time interpreter

import { assertEquals, assertThrows } from "https://deno.land/std@0.208.0/assert/mod.ts";
import { Interpreter, createStandardEnv, hqlValueToSExp } from "../../../src/interpreter/index.ts";
import { InterpreterEnv } from "../../../src/interpreter/environment.ts";
import { parse } from "../../../src/transpiler/pipeline/parser.ts";
import { sexpToString, createLiteral, createList, type SSymbol, type SList } from "../../../src/s-exp/types.ts";

// Helper to parse and evaluate an expression
function evalExpr(code: string, env?: InterpreterEnv) {
  const interpreter = new Interpreter();
  const exprs = parse(code);
  if (exprs.length === 0) throw new Error("No expressions to evaluate");
  const result = interpreter.eval(exprs[0], env ?? createStandardEnv());
  return result;
}

// Helper to convert result to string for easy comparison
function evalToString(code: string, env?: InterpreterEnv): string {
  const result = evalExpr(code, env);
  const sexp = hqlValueToSExp(result);
  return sexpToString(sexp);
}

// ============================================================================
// Basic Literals
// ============================================================================

Deno.test("Interpreter - Literals: numbers", () => {
  assertEquals(evalExpr("42"), 42);
  assertEquals(evalExpr("3.14"), 3.14);
  assertEquals(evalExpr("-17"), -17);
});

Deno.test("Interpreter - Literals: strings", () => {
  assertEquals(evalExpr('"hello"'), "hello");
  assertEquals(evalExpr('""'), "");
});

Deno.test("Interpreter - Literals: booleans", () => {
  assertEquals(evalExpr("true"), true);
  assertEquals(evalExpr("false"), false);
});

Deno.test("Interpreter - Literals: nil", () => {
  assertEquals(evalExpr("nil"), null);
});

// ============================================================================
// Arithmetic Operations
// ============================================================================

Deno.test("Interpreter - Arithmetic: addition", () => {
  assertEquals(evalExpr("(+ 1 2)"), 3);
  assertEquals(evalExpr("(+ 1 2 3)"), 6);
  assertEquals(evalExpr("(+)"), 0);
});

Deno.test("Interpreter - Arithmetic: subtraction", () => {
  assertEquals(evalExpr("(- 10 3)"), 7);
  assertEquals(evalExpr("(- 10 3 2)"), 5);
  assertEquals(evalExpr("(- 5)"), -5);
});

Deno.test("Interpreter - Arithmetic: multiplication", () => {
  assertEquals(evalExpr("(* 2 3)"), 6);
  assertEquals(evalExpr("(* 2 3 4)"), 24);
  assertEquals(evalExpr("(*)"), 1);
});

Deno.test("Interpreter - Arithmetic: division", () => {
  assertEquals(evalExpr("(/ 10 2)"), 5);
  assertEquals(evalExpr("(/ 24 2 3)"), 4);
});

Deno.test("Interpreter - Arithmetic: modulo", () => {
  assertEquals(evalExpr("(% 10 3)"), 1);
  assertEquals(evalExpr("(mod 10 3)"), 1);
});

// ============================================================================
// Comparison Operations
// ============================================================================

Deno.test("Interpreter - Comparison: equality", () => {
  assertEquals(evalExpr("(= 1 1)"), true);
  assertEquals(evalExpr("(= 1 2)"), false);
  assertEquals(evalExpr("(== 1 1)"), true);
});

Deno.test("Interpreter - Comparison: less than", () => {
  assertEquals(evalExpr("(< 1 2)"), true);
  assertEquals(evalExpr("(< 2 1)"), false);
  assertEquals(evalExpr("(< 1 2 3)"), true);
});

Deno.test("Interpreter - Comparison: greater than", () => {
  assertEquals(evalExpr("(> 2 1)"), true);
  assertEquals(evalExpr("(> 1 2)"), false);
  assertEquals(evalExpr("(> 3 2 1)"), true);
});

// ============================================================================
// Special Forms
// ============================================================================

Deno.test("Interpreter - Special form: if", () => {
  assertEquals(evalExpr("(if true 1 2)"), 1);
  assertEquals(evalExpr("(if false 1 2)"), 2);
  assertEquals(evalExpr("(if nil 1 2)"), 2);
  assertEquals(evalExpr("(if true 1)"), 1);
  assertEquals(evalExpr("(if false 1)"), null);
});

Deno.test("Interpreter - Special form: let", () => {
  assertEquals(evalExpr("(let (x 1) x)"), 1);
  assertEquals(evalExpr("(let (x 1 y 2) (+ x y))"), 3);
  assertEquals(evalExpr("(let (x 1) (let (y 2) (+ x y)))"), 3);
});

Deno.test("Interpreter - Special form: do", () => {
  assertEquals(evalExpr("(do 1 2 3)"), 3);
  assertEquals(evalExpr("(do)"), null);
});

Deno.test("Interpreter - Special form: quote", () => {
  const result = evalExpr("(quote x)");
  assertEquals((result as SSymbol).name, "x");
});

Deno.test("Interpreter - Special form: fn - anonymous function", () => {
  assertEquals(evalExpr("((fn (x) (* x 2)) 5)"), 10);
  assertEquals(evalExpr("((fn (a b) (+ a b)) 3 4)"), 7);
});

Deno.test("Interpreter - Special form: fn - named function", () => {
  const env = createStandardEnv();
  evalExpr("(fn double (x) (* x 2))", env);
  assertEquals(evalExpr("(double 5)", env), 10);
});

Deno.test("Interpreter - Special form: fn - rest parameters", () => {
  // Use 'count' (stdlib) instead of '%length' (compiler primitive)
  assertEquals(evalExpr("((fn (& args) (count args)) 1 2 3)"), 3);
});

// ============================================================================
// Closures
// ============================================================================

Deno.test("Interpreter - Closures: basic closure", () => {
  const env = createStandardEnv();
  evalExpr("(fn make-adder (n) (fn (x) (+ x n)))", env);
  evalExpr("(var add5 (make-adder 5))", env);
  assertEquals(evalExpr("(add5 10)", env), 15);
});

Deno.test("Interpreter - Closures: nested closures", () => {
  const env = createStandardEnv();
  evalExpr("(fn outer (a) (fn middle (b) (fn inner (c) (+ a b c))))", env);
  assertEquals(evalExpr("(((outer 1) 2) 3)", env), 6);
});

// ============================================================================
// Type Predicates
// ============================================================================

Deno.test("Interpreter - Type predicates: nil?", () => {
  assertEquals(evalExpr("(nil? nil)"), true);
  assertEquals(evalExpr("(nil? 1)"), false);
});

Deno.test("Interpreter - Type predicates: number?", () => {
  assertEquals(evalExpr("(number? 42)"), true);
  assertEquals(evalExpr('(number? "hello")'), false);
});

Deno.test("Interpreter - Type predicates: string?", () => {
  assertEquals(evalExpr('(string? "hello")'), true);
  assertEquals(evalExpr("(string? 42)"), false);
});

// ============================================================================
// Stdlib Functions
// ============================================================================

Deno.test("Interpreter - Stdlib: first", () => {
  const result = evalExpr("(first [1 2 3])");
  assertEquals(result, 1);
});

Deno.test("Interpreter - Stdlib: rest", () => {
  const result = evalExpr("(rest [1 2 3])") as unknown[];
  assertEquals(result, [2, 3]);
});

Deno.test("Interpreter - Stdlib: count", () => {
  assertEquals(evalExpr("(count (vector 1 2 3))"), 3);
  assertEquals(evalExpr("(count (empty-array))"), 0);
});

// Note: map/filter/reduce with stdlib functions like `inc` require proper
// function wrapping that passes through the lazy evaluation. This is a
// known complexity. For macro-time use, we typically use %first, %rest, etc.

Deno.test("Interpreter - Stdlib: concat", () => {
  const result = evalExpr("(concat (vector 1 2) (vector 3 4))") as number[];
  assertEquals(result, [1, 2, 3, 4]);
});

Deno.test("Interpreter - Stdlib: range", () => {
  const result = evalExpr("(range 5)") as number[];
  assertEquals(result, [0, 1, 2, 3, 4]);
});

Deno.test("Interpreter - Stdlib: take", () => {
  const result = evalExpr("(take 3 (range 10))") as number[];
  assertEquals(result, [0, 1, 2]);
});

// ============================================================================
// Quasiquote
// ============================================================================

Deno.test("Interpreter - Quasiquote: basic", () => {
  const result = evalToString("`(a b c)");
  assertEquals(result, "(a b c)");
});

Deno.test("Interpreter - Quasiquote: with unquote", () => {
  const env = createStandardEnv();
  env.define("x", 42);
  const result = evalToString("`(a ~x c)", env);
  assertEquals(result, "(a 42 c)");
});

Deno.test("Interpreter - Quasiquote: with unquote-splicing", () => {
  const env = createStandardEnv();
  env.define("items", [1, 2, 3]);
  const result = evalToString("`(a ~@items c)", env);
  assertEquals(result, "(a 1 2 3 c)");
});

// ============================================================================
// Recursion
// ============================================================================

Deno.test("Interpreter - Recursion: factorial", () => {
  const env = createStandardEnv();
  evalExpr(`
    (fn factorial (n)
      (if (<= n 1)
        1
        (* n (factorial (- n 1)))))
  `, env);
  assertEquals(evalExpr("(factorial 5)", env), 120);
});

Deno.test("Interpreter - Recursion: fibonacci", () => {
  const env = createStandardEnv();
  evalExpr(`
    (fn fib (n)
      (if (<= n 1)
        n
        (+ (fib (- n 1)) (fib (- n 2)))))
  `, env);
  assertEquals(evalExpr("(fib 10)", env), 55);
});

// ============================================================================
// Error Handling
// ============================================================================

Deno.test("Interpreter - Error: undefined symbol", () => {
  assertThrows(
    () => evalExpr("undefined-symbol"),
    Error,
    "Undefined symbol"
  );
});

Deno.test("Interpreter - Error: max call depth", () => {
  const env = createStandardEnv();
  evalExpr("(fn infinite () (infinite))", env);
  assertThrows(
    () => evalExpr("(infinite)", env),
    Error,
    "call depth"
  );
});

// ============================================================================
// Higher-Order Functions with HQL Functions
// ============================================================================

Deno.test("Interpreter - Stdlib HOF: map with HQL function", () => {
  const result = evalExpr("(map (fn [x] (* 2 x)) [1 2 3])") as number[];
  assertEquals(result, [2, 4, 6]);
});

Deno.test("Interpreter - Stdlib HOF: filter with HQL function", () => {
  const result = evalExpr("(filter (fn [x] (> x 2)) [1 2 3 4 5])") as number[];
  assertEquals(result, [3, 4, 5]);
});

Deno.test("Interpreter - Stdlib HOF: reduce with HQL function", () => {
  const result = evalExpr("(reduce (fn [acc x] (+ acc x)) 0 [1 2 3 4 5])");
  assertEquals(result, 15);
});

Deno.test("Interpreter - Stdlib HOF: nested HOF", () => {
  const env = createStandardEnv();
  evalExpr("(var double (fn [x] (* 2 x)))", env);
  evalExpr("(var even? (fn [x] (= 0 (% x 2))))", env);
  const result = evalExpr("(filter even? (map double [1 2 3 4 5]))", env) as number[];
  assertEquals(result, [2, 4, 6, 8, 10]);
});

Deno.test("Interpreter - Stdlib HOF: named function", () => {
  const env = createStandardEnv();
  evalExpr("(fn square (x) (* x x))", env);
  const result = evalExpr("(map square [1 2 3 4])", env) as number[];
  assertEquals(result, [1, 4, 9, 16]);
});

Deno.test("Interpreter - Stdlib HOF: closure captures", () => {
  const env = createStandardEnv();
  evalExpr("(fn make-adder (n) (fn [x] (+ x n)))", env);
  evalExpr("(var add10 (make-adder 10))", env);
  const result = evalExpr("(map add10 [1 2 3])", env) as number[];
  assertEquals(result, [11, 12, 13]);
});
