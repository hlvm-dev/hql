/**
 * Template Literal Tests
 *
 * Tests ES6 template literal syntax with backticks and ${} interpolation.
 *
 * Syntax: `string ${expr} string`
 *
 * Features tested:
 * - Basic template literals (no interpolation)
 * - Single interpolation (various positions)
 * - Multiple interpolations
 * - Nested expressions in interpolations
 * - Escape sequences
 * - Complex expressions
 * - Edge cases
 */

import { assertEquals } from "https://deno.land/std@0.208.0/assert/mod.ts";
import { run } from "./helpers.ts";

// ============================================================================
// Basic Template Literals (No Interpolation)
// ============================================================================

Deno.test("Template Literal: plain string", async () => {
  const result = await run('`hello world`');
  assertEquals(result, "hello world");
});

Deno.test("Template Literal: empty string", async () => {
  const result = await run('``');
  assertEquals(result, "");
});

Deno.test("Template Literal: string with spaces", async () => {
  const result = await run('`  spaces around  `');
  assertEquals(result, "  spaces around  ");
});

// ============================================================================
// Single Interpolation
// ============================================================================

Deno.test("Template Literal: interpolation at beginning", async () => {
  const result = await run('`${10} apples`');
  assertEquals(result, "10 apples");
});

Deno.test("Template Literal: interpolation in middle", async () => {
  const result = await run('`I have ${5} apples`');
  assertEquals(result, "I have 5 apples");
});

Deno.test("Template Literal: interpolation at end", async () => {
  const result = await run('`Total: ${42}`');
  assertEquals(result, "Total: 42");
});

Deno.test("Template Literal: only interpolation", async () => {
  const result = await run('`${100}`');
  assertEquals(result, "100");
});

// ============================================================================
// Multiple Interpolations
// ============================================================================

Deno.test("Template Literal: two interpolations", async () => {
  const result = await run('`${1} + ${2} = 3`');
  assertEquals(result, "1 + 2 = 3");
});

Deno.test("Template Literal: three interpolations", async () => {
  const result = await run('`${1}, ${2}, ${3}`');
  assertEquals(result, "1, 2, 3");
});

Deno.test("Template Literal: consecutive interpolations", async () => {
  const result = await run('`${10}${20}`');
  assertEquals(result, "1020");
});

// ============================================================================
// Expressions in Interpolations
// ============================================================================

Deno.test("Template Literal: arithmetic expression", async () => {
  const result = await run('`Result: ${(+ 10 5)}`');
  assertEquals(result, "Result: 15");
});

Deno.test("Template Literal: nested expression", async () => {
  const result = await run('`Answer: ${(* (+ 2 3) 4)}`');
  assertEquals(result, "Answer: 20");
});

Deno.test("Template Literal: boolean expression", async () => {
  const result = await run('`Is true: ${(> 5 3)}`');
  assertEquals(result, "Is true: true");
});

Deno.test("Template Literal: string expression", async () => {
  const result = await run('`Message: ${(+ "Hello" " " "World")}`');
  assertEquals(result, "Message: Hello World");
});

// ============================================================================
// Variables in Interpolations
// ============================================================================

Deno.test("Template Literal: variable reference", async () => {
  const result = await run(`
    (let x 42)
    \`Value: \${x}\`
  `);
  assertEquals(result, "Value: 42");
});

Deno.test("Template Literal: multiple variable references", async () => {
  const result = await run(`
    (let name "Alice")
    (let age 30)
    \`\${name} is \${age} years old\`
  `);
  assertEquals(result, "Alice is 30 years old");
});

// ============================================================================
// Function Calls in Interpolations
// ============================================================================

Deno.test("Template Literal: function call", async () => {
  const result = await run(`
    (fn double [x] (* x 2))
    \`Result: \${(double 21)}\`
  `);
  assertEquals(result, "Result: 42");
});

Deno.test("Template Literal: multiple function calls", async () => {
  const result = await run(`
    (fn add [a b] (+ a b))
    (fn mul [a b] (* a b))
    \`\${(add 2 3)} * \${(mul 4 5)} = \${(mul (add 2 3) (mul 4 5))}\`
  `);
  assertEquals(result, "5 * 20 = 100");
});

// ============================================================================
// Escape Sequences
// ============================================================================

Deno.test("Template Literal: escaped backtick", async () => {
  const result = await run('`This is a \\` backtick`');
  assertEquals(result, "This is a ` backtick");
});

Deno.test("Template Literal: escaped dollar sign", async () => {
  const result = await run('`Price: \\$100`');
  assertEquals(result, "Price: $100");
});

Deno.test("Template Literal: newline escape", async () => {
  const result = await run('`Line 1\\nLine 2`');
  assertEquals(result, "Line 1\nLine 2");
});

Deno.test("Template Literal: tab escape", async () => {
  const result = await run('`Col1\\tCol2`');
  assertEquals(result, "Col1\tCol2");
});

Deno.test("Template Literal: backslash escape", async () => {
  const result = await run('`Path: C:\\\\Users`');
  assertEquals(result, "Path: C:\\Users");
});

// ============================================================================
// Complex Expressions
// ============================================================================

Deno.test("Template Literal: ternary in interpolation", async () => {
  const result = await run('`Status: ${(? true "active" "inactive")}`');
  assertEquals(result, "Status: active");
});

Deno.test("Template Literal: array access", async () => {
  const result = await run(`
    (let arr [10 20 30])
    \`Second element: \${(get arr 1)}\`
  `);
  assertEquals(result, "Second element: 20");
});

Deno.test("Template Literal: object property", async () => {
  const result = await run(`
    (let obj {"name": "Bob" "age": 25})
    \`Name: \${(get obj "name")}\`
  `);
  assertEquals(result, "Name: Bob");
});

// ============================================================================
// Integration with Other Features
// ============================================================================

Deno.test("Template Literal: in return statement", async () => {
  const result = await run(`
    (fn greet [name] \`Hello, \${name}!\`)
    (greet "World")
  `);
  assertEquals(result, "Hello, World!");
});

Deno.test("Template Literal: in variable assignment", async () => {
  const result = await run(`
    (let x 10)
    (let message \`Value is \${x}\`)
    message
  `);
  assertEquals(result, "Value is 10");
});

Deno.test("Template Literal: in array", async () => {
  const result = await run(`
    (let arr [\`first\` \`second \${2}\` \`third\`])
    (get arr 1)
  `);
  assertEquals(result, "second 2");
});

Deno.test("Template Literal: in object", async () => {
  const result = await run(`
    (let greeting \`Hello World\`)
    (let obj {"greeting": greeting})
    (get obj "greeting")
  `);
  assertEquals(result, "Hello World");
});
