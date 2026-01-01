/**
 * Pattern Matching Tests
 *
 * Tests for HQL's pattern matching syntax:
 * (match value
 *   (case pattern result)
 *   (case pattern (if guard) result)
 *   (default result))
 */

import { assertEquals } from "jsr:@std/assert";
import { transpileToJavascript } from "../../src/transpiler/hql-transpiler.ts";

// Helper function needed for HQL hash-map literals
// This should normally be embedded by the transpiler, but we include it here for test eval
// deno-lint-ignore no-explicit-any
(globalThis as any).__hql_hash_map = function(...args: unknown[]) {
  const result: Record<string, unknown> = {};
  for (let i = 0; i < args.length; i += 2) {
    result[args[i] as string] = args[i + 1];
  }
  return result;
};

// Helper function needed for pattern matching object checks
// Checks if val is an object with all required keys from the pattern
// Pattern format: ["__hql_hash_map", key1, var1, key2, var2, ...]
// deno-lint-ignore no-explicit-any
(globalThis as any).__hql_match_obj = function(val: unknown, pattern: unknown[]): boolean {
  if (typeof val !== "object" || val === null || Array.isArray(val)) {
    return false;
  }
  // Extract keys from odd indices (1, 3, 5, ...) and check existence
  for (let i = 1; i < pattern.length; i += 2) {
    const key = pattern[i];
    if (typeof key === "string" && !(key in (val as Record<string, unknown>))) {
      return false;
    }
  }
  return true;
};

async function transpile(code: string): Promise<string> {
  const result = await transpileToJavascript(code);
  return result.code.trim();
}

async function evalHql(code: string): Promise<unknown> {
  const js = await transpile(code);
  return eval(js);
}

// ============================================
// LITERAL MATCHING
// ============================================

Deno.test("Pattern Matching - Literal number match", async () => {
  const code = `
    (match 42
      (case 42 "forty-two")
      (case 0 "zero")
      (default "other"))
  `;
  const result = await evalHql(code);
  assertEquals(result, "forty-two");
});

Deno.test("Pattern Matching - Literal string match", async () => {
  const code = `
    (match "hello"
      (case "hello" "greeting")
      (case "bye" "farewell")
      (default "other"))
  `;
  const result = await evalHql(code);
  assertEquals(result, "greeting");
});

Deno.test("Pattern Matching - Literal boolean match", async () => {
  const code = `
    (match true
      (case true "yes")
      (case false "no")
      (default "other"))
  `;
  const result = await evalHql(code);
  assertEquals(result, "yes");
});

Deno.test("Pattern Matching - Literal null match", async () => {
  const code = `
    (match null
      (case null "nothing")
      (default "something"))
  `;
  const result = await evalHql(code);
  assertEquals(result, "nothing");
});

Deno.test("Pattern Matching - Falls through to next case", async () => {
  const code = `
    (match 100
      (case 42 "forty-two")
      (case 0 "zero")
      (default "other"))
  `;
  const result = await evalHql(code);
  assertEquals(result, "other");
});

// ============================================
// SYMBOL BINDING
// ============================================

Deno.test("Pattern Matching - Symbol binding", async () => {
  const code = `
    (match 42
      (case x (+ x 1)))
  `;
  const result = await evalHql(code);
  assertEquals(result, 43);
});

Deno.test("Pattern Matching - Symbol binding with default", async () => {
  const code = `
    (match "test"
      (case 42 "number")
      (case s (+ "value: " s)))
  `;
  const result = await evalHql(code);
  assertEquals(result, "value: test");
});

// ============================================
// WILDCARD
// ============================================

Deno.test("Pattern Matching - Wildcard matches anything", async () => {
  const code = `
    (match "anything"
      (case _ "matched"))
  `;
  const result = await evalHql(code);
  assertEquals(result, "matched");
});

Deno.test("Pattern Matching - Wildcard as fallback", async () => {
  const code = `
    (match 999
      (case 1 "one")
      (case 2 "two")
      (case _ "other"))
  `;
  const result = await evalHql(code);
  assertEquals(result, "other");
});

// ============================================
// ARRAY PATTERNS
// ============================================

Deno.test("Pattern Matching - Empty array pattern", async () => {
  const code = `
    (match []
      (case [] "empty")
      (default "not empty"))
  `;
  const result = await evalHql(code);
  assertEquals(result, "empty");
});

Deno.test("Pattern Matching - Single element array", async () => {
  const code = `
    (match [42]
      (case [] "empty")
      (case [x] (+ "one: " x))
      (default "other"))
  `;
  const result = await evalHql(code);
  assertEquals(result, "one: 42");
});

Deno.test("Pattern Matching - Two element array", async () => {
  const code = `
    (match [1, 2]
      (case [] "empty")
      (case [x] "one")
      (case [a, b] (+ a b))
      (default "other"))
  `;
  const result = await evalHql(code);
  assertEquals(result, 3);
});

Deno.test("Pattern Matching - Array rest pattern", async () => {
  const code = `
    (match [1, 2, 3, 4]
      (case [] "empty")
      (case [h, & t] t))
  `;
  const result = await evalHql(code);
  assertEquals(result, [2, 3, 4]);
});

Deno.test("Pattern Matching - Array rest pattern head", async () => {
  const code = `
    (match [10, 20, 30]
      (case [h, & t] h))
  `;
  const result = await evalHql(code);
  assertEquals(result, 10);
});

Deno.test("Pattern Matching - Non-array doesn't match array pattern", async () => {
  const code = `
    (match "not array"
      (case [x] "array")
      (default "not array"))
  `;
  const result = await evalHql(code);
  assertEquals(result, "not array");
});

// ============================================
// OBJECT PATTERNS
// ============================================

Deno.test("Pattern Matching - Object binding", async () => {
  const code = `
    (match {"name": "Alice", "age": 30}
      (case {name: n, age: a} (+ n " is " a))
      (default "no match"))
  `;
  const result = await evalHql(code);
  assertEquals(result, "Alice is 30");
});

Deno.test("Pattern Matching - Object single key binding", async () => {
  const code = `
    (match {"x": 10}
      (case {x: val} val)
      (default 0))
  `;
  const result = await evalHql(code);
  assertEquals(result, 10);
});

Deno.test("Pattern Matching - Non-object doesn't match object pattern", async () => {
  const code = `
    (match [1, 2, 3]
      (case {x: v} "object")
      (default "not object"))
  `;
  const result = await evalHql(code);
  assertEquals(result, "not object");
});

// ============================================
// GUARDS
// ============================================

Deno.test("Pattern Matching - Guard passes", async () => {
  const code = `
    (match 10
      (case x (if (> x 0)) "positive")
      (default "non-positive"))
  `;
  const result = await evalHql(code);
  assertEquals(result, "positive");
});

Deno.test("Pattern Matching - Guard fails, falls through", async () => {
  const code = `
    (match -5
      (case x (if (> x 0)) "positive")
      (default "non-positive"))
  `;
  const result = await evalHql(code);
  assertEquals(result, "non-positive");
});

Deno.test("Pattern Matching - Multiple guards", async () => {
  const code = `
    (match 0
      (case x (if (> x 0)) "positive")
      (case x (if (< x 0)) "negative")
      (default "zero"))
  `;
  const result = await evalHql(code);
  assertEquals(result, "zero");
});

Deno.test("Pattern Matching - Guard with array binding", async () => {
  const code = `
    (match [5, 3]
      (case [a, b] (if (> a b)) "a > b")
      (case [a, b] (if (< a b)) "a < b")
      (default "a = b"))
  `;
  const result = await evalHql(code);
  assertEquals(result, "a > b");
});

// ============================================
// DEFAULT CLAUSE
// ============================================

Deno.test("Pattern Matching - Default is executed when no match", async () => {
  const code = `
    (match "unmatchable"
      (case 1 "one")
      (case 2 "two")
      (default "default"))
  `;
  const result = await evalHql(code);
  assertEquals(result, "default");
});

Deno.test("Pattern Matching - Default can have complex expression", async () => {
  const code = `
    (match 999
      (case 1 "one")
      (default (+ "fallback: " 999)))
  `;
  const result = await evalHql(code);
  assertEquals(result, "fallback: 999");
});

// ============================================
// NESTED PATTERNS
// ============================================

Deno.test("Pattern Matching - Nested array", async () => {
  const code = `
    (match [[1, 2], [3, 4]]
      (case [[a, b], [c, d]] (+ a b c d))
      (default 0))
  `;
  const result = await evalHql(code);
  assertEquals(result, 10);
});

Deno.test("Pattern Matching - Object with array value", async () => {
  const code = `
    (match {"coords": [10, 20]}
      (case {coords: [x, y]} (+ x y))
      (default 0))
  `;
  const result = await evalHql(code);
  assertEquals(result, 30);
});

// ============================================
// RECURSIVE PATTERNS
// ============================================

Deno.test("Pattern Matching - Recursive sum", async () => {
  const code = `
    (fn sum [lst]
      (match lst
        (case [] 0)
        (case [x] x)
        (case [h, & t] (+ h (sum t)))))
    (sum [1, 2, 3, 4, 5])
  `;
  const result = await evalHql(code);
  assertEquals(result, 15);
});

Deno.test("Pattern Matching - Recursive length", async () => {
  const code = `
    (fn my-length [lst]
      (match lst
        (case [] 0)
        (case [_, & t] (+ 1 (my-length t)))))
    (my-length [1, 2, 3, 4])
  `;
  const result = await evalHql(code);
  assertEquals(result, 4);
});

// ============================================
// COMPLEX EXAMPLES
// ============================================

// Note: Object patterns with literal value matching like {status: 200} are not yet supported.
// These tests use simpler patterns that bind all keys.
Deno.test("Pattern Matching - HTTP response handler", async () => {
  const code = `
    (fn handle-response [res]
      (match res
        (case {status: s} (if (=== s 200) "ok" (if (=== s 404) "not found" "error")))
        (default "unknown")))
    (handle-response {"status": 200})
  `;
  const result = await evalHql(code);
  assertEquals(result, "ok");
});

Deno.test("Pattern Matching - Event handler", async () => {
  const code = `
    (fn handle-event [event]
      (match event
        (case {type: t, x: x, y: y} (if (=== t "click") (+ "click at " x "," y) "other"))
        (default "unknown event")))
    (handle-event {"type": "click", "x": 100, "y": 200})
  `;
  const result = await evalHql(code);
  assertEquals(result, "click at 100,200");
});

// ============================================
// GENERATED CODE QUALITY
// ============================================

Deno.test("Pattern Matching - Generated code doesn't contain 'match' keyword", async () => {
  const code = `
    (match 42
      (case 42 "yes")
      (default "no"))
  `;
  const js = await transpile(code);
  // The generated code uses match_N as variable names, which is fine.
  // We just check that 'match' is not used as a keyword/function call.
  // match_N variable names are acceptable.
  const hasMatchKeyword = /[^_a-zA-Z0-9]match[^_a-zA-Z0-9]/.test(` ${js} `);
  assertEquals(hasMatchKeyword, false, `Generated code should not contain 'match' as keyword: ${js}`);
});

Deno.test("Pattern Matching - Generated code doesn't contain 'case'", async () => {
  const code = `
    (match 42
      (case 42 "yes")
      (default "no"))
  `;
  const js = await transpile(code);
  assertEquals(js.includes("case "), false, `Generated code should not contain 'case': ${js}`);
});
