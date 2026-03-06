import { assertEquals, assertThrows } from "jsr:@std/assert@1";
import { createStandardEnv, hqlValueToSExp, Interpreter } from "../../../src/hql/interpreter/index.ts";
import type { InterpreterEnv } from "../../../src/hql/interpreter/environment.ts";
import { parse } from "../../../src/hql/transpiler/pipeline/parser.ts";
import { sexpToString, type SSymbol } from "../../../src/hql/s-exp/types.ts";

function evalExpr(code: string, env?: InterpreterEnv) {
  const interpreter = new Interpreter();
  const exprs = parse(code);
  if (exprs.length === 0) throw new Error("No expressions to evaluate");
  return interpreter.eval(exprs[0], env ?? createStandardEnv());
}

function evalToString(code: string, env?: InterpreterEnv): string {
  return sexpToString(hqlValueToSExp(evalExpr(code, env)));
}

Deno.test("Interpreter: literals preserve HQL runtime values", () => {
  assertEquals(evalExpr("42"), 42);
  assertEquals(evalExpr("3.14"), 3.14);
  assertEquals(evalExpr('"hello"'), "hello");
  assertEquals(evalExpr('""'), "");
  assertEquals(evalExpr("true"), true);
  assertEquals(evalExpr("false"), false);
  assertEquals(evalExpr("nil"), null);
});

Deno.test("Interpreter: arithmetic and comparison operators cover unary, variadic, and chained forms", () => {
  const result = evalExpr(`
    [
      (+ 1 2 3)
      (+)
      (- 10 3 2)
      (- 5)
      (* 2 3 4)
      (*)
      (/ 24 2 3)
      (% 10 3)
      (mod 10 3)
      (= 1 1)
      (== 1 1)
      (< 1 2 3)
      (> 3 2 1)
    ]
  `) as unknown[];

  assertEquals(result, [6, 0, 5, -5, 24, 1, 4, 1, 1, true, true, true, true]);
});

Deno.test("Interpreter: core special forms handle control flow, scope, sequencing, and quoting", () => {
  assertEquals(evalExpr("(if true 1 2)"), 1);
  assertEquals(evalExpr("(if false 1)"), null);
  assertEquals(evalExpr("(let (x 1 y 2) (+ x y))"), 3);
  assertEquals(evalExpr("(do 1 2 3)"), 3);

  const quoted = evalExpr("(quote x)") as SSymbol;
  assertEquals(quoted.name, "x");
});

Deno.test("Interpreter: functions support anonymous calls, named definitions, rest args, and closures", () => {
  assertEquals(evalExpr("((fn (x) (* x 2)) 5)"), 10);
  assertEquals(evalExpr("((fn (a b) (+ a b)) 3 4)"), 7);
  assertEquals(evalExpr("((fn (& args) (count args)) 1 2 3)"), 3);

  const env = createStandardEnv();
  evalExpr("(fn double (x) (* x 2))", env);
  evalExpr("(fn make-adder (n) (fn (x) (+ x n)))", env);
  evalExpr("(fn outer (a) (fn middle (b) (fn inner (c) (+ a b c))))", env);
  evalExpr("(var add5 (make-adder 5))", env);

  assertEquals(evalExpr("(double 5)", env), 10);
  assertEquals(evalExpr("(add5 10)", env), 15);
  assertEquals(evalExpr("(((outer 1) 2) 3)", env), 6);
});

Deno.test("Interpreter: type predicates and core stdlib sequence functions work together", () => {
  const result = evalExpr(`
    [
      (isNil nil)
      (isNil 1)
      (isNumber 42)
      (isString "hello")
      (first [1 2 3])
      (rest [1 2 3])
      (count (vector 1 2 3))
      (concat (vector 1 2) (vector 3 4))
      (range 5)
      (take 3 (range 10))
    ]
  `) as unknown[];

  assertEquals(result, [
    true,
    false,
    true,
    true,
    1,
    [2, 3],
    3,
    [1, 2, 3, 4],
    [0, 1, 2, 3, 4],
    [0, 1, 2],
  ]);
});

Deno.test("Interpreter: quasiquote supports unquote and unquote-splicing", () => {
  const env = createStandardEnv();
  env.define("x", 42);
  env.define("items", [1, 2, 3]);

  assertEquals(evalToString("`(a b c)", env), "(a b c)");
  assertEquals(evalToString("`(a ~x c)", env), "(a 42 c)");
  assertEquals(evalToString("`(a ~@items c)", env), "(a 1 2 3 c)");
});

Deno.test("Interpreter: recursion and higher-order stdlib functions compose correctly", () => {
  const env = createStandardEnv();
  evalExpr(`
    (fn factorial (n)
      (if (<= n 1)
        1
        (* n (factorial (- n 1)))))
  `, env);
  evalExpr(`
    (fn fib (n)
      (if (<= n 1)
        n
        (+ (fib (- n 1)) (fib (- n 2)))))
  `, env);
  evalExpr("(fn square (x) (* x x))", env);
  evalExpr("(fn make-adder (n) (fn [x] (+ x n)))", env);
  evalExpr("(var add10 (make-adder 10))", env);

  assertEquals(evalExpr("(factorial 5)", env), 120);
  assertEquals(evalExpr("(fib 10)", env), 55);
  assertEquals(evalExpr("(map (fn [x] (* 2 x)) [1 2 3])", env), [2, 4, 6]);
  assertEquals(evalExpr("(filter (fn [x] (> x 2)) [1 2 3 4 5])", env), [3, 4, 5]);
  assertEquals(evalExpr("(reduce (fn [acc x] (+ acc x)) 0 [1 2 3 4 5])", env), 15);
  assertEquals(evalExpr("(map square [1 2 3 4])", env), [1, 4, 9, 16]);
  assertEquals(evalExpr("(map add10 [1 2 3])", env), [11, 12, 13]);
});

Deno.test("Interpreter: undefined symbols and runaway recursion throw", () => {
  assertThrows(() => evalExpr("undefined-symbol"), Error, "is not defined");

  const env = createStandardEnv();
  evalExpr("(fn infinite () (infinite))", env);
  assertThrows(() => evalExpr("(infinite)", env), Error, "call depth");
});
