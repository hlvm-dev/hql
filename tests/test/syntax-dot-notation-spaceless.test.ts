// test/syntax-dot-notation-spaceless.test.ts
// Comprehensive tests for spaceless dot notation support
// Verifies that (obj.method.chain) works identically to (obj .method .chain)

import { assertEquals } from "https://deno.land/std@0.208.0/assert/mod.ts";
import { run } from "./helpers.ts";
import hql from "../../mod.ts";

/**
 * Test helper - verifies both syntaxes generate identical JavaScript
 */
async function testEquivalence(
  spaceless: string,
  spaced: string,
  description: string,
) {
  const spacelessJS = await hql.transpile(spaceless);
  const spacedJS = await hql.transpile(spaced);

  const spacelessCode = typeof spacelessJS === 'string' ? spacelessJS : spacelessJS.code;
  const spacedCode = typeof spacedJS === 'string' ? spacedJS : spacedJS.code;

  assertEquals(
    spacelessCode,
    spacedCode,
    `${description}: Spaceless and spaced should generate identical JS`,
  );

  // Also verify runtime behavior matches
  const spacelessResult = await run(spaceless);
  const spacedResult = await run(spaced);
  assertEquals(
    spacelessResult,
    spacedResult,
    `${description}: Runtime results should match`,
  );
}

// ============================================================================
// SECTION 1: EQUIVALENCE TESTS (Spaced vs Spaceless)
// ============================================================================

Deno.test("Equivalence: Method chain - no args", async () => {
  await testEquivalence(
    '(var text "  hello  ") (text.trim.toUpperCase)',
    '(var text "  hello  ") (text .trim .toUpperCase)',
    "Method chaining without arguments",
  );
});

Deno.test("Equivalence: Method chain - with args", async () => {
  await testEquivalence(
    "(var arr [1 2 3 4 5]) (arr.map (fn [x] (* x 2)).filter (fn [x] (> x 5)))",
    "(var arr [1 2 3 4 5]) (arr .map (fn [x] (* x 2)) .filter (fn [x] (> x 5)))",
    "Method chaining with arguments",
  );
});

Deno.test("Equivalence: Single method call", async () => {
  await testEquivalence(
    "(var arr [1 2 3]) (arr.push 99) arr",
    "(var arr [1 2 3]) (arr .push 99) arr",
    "Single method call",
  );
});

Deno.test("Equivalence: Multiple args per method", async () => {
  await testEquivalence(
    '(var str "hello") (str.replace "l" "L".toUpperCase)',
    '(var str "hello") (str .replace "l" "L" .toUpperCase)',
    "Method with multiple arguments then chain",
  );
});

Deno.test("Equivalence: Complex chain with multiple args", async () => {
  await testEquivalence(
    "(var arr [1 2 3 4 5]) ((arr.slice 1 4).map (fn [x] (* x 10)))",
    "(var arr [1 2 3 4 5]) ((arr .slice 1 4) .map (fn [x] (* x 10)))",
    "Complex chain with multiple arguments",
  );
});

// ============================================================================
// SECTION 2: SPACELESS FUNCTIONALITY TESTS
// ============================================================================

Deno.test("Spaceless: Simple chain no args", async () => {
  const code = '(var text "  test  ") (text.trim.toUpperCase)';
  const result = await run(code);
  assertEquals(result, "TEST");
});

Deno.test("Spaceless: Chain with arguments", async () => {
  const code =
    "(var arr [1 2 3 4 5 6]) (arr.filter (fn [x] (> x 3)).map (fn [x] (* x 2)))";
  const result = await run(code);
  assertEquals(result, [8, 10, 12]);
});

Deno.test("Spaceless: Triple chain", async () => {
  const code =
    '(var text "  hello world  ") (text.trim.toUpperCase.split " ")';
  const result = await run(code);
  assertEquals(result, ["HELLO", "WORLD"]);
});

Deno.test("Spaceless: Long chain", async () => {
  const code =
    "(var arr [1 2 3]) (arr.push 4) (arr.push 5) (arr.push 6) (arr.slice 0 3)";
  const result = await run(code);
  assertEquals(result, [1, 2, 3]);
});

// ============================================================================
// SECTION 3: EDGE CASES
// ============================================================================

Deno.test("Edge Case: js/ prefix not normalized", async () => {
  const code = '(js/console.log "test") "success"';
  const result = await run(code);
  assertEquals(result, "success");
});

Deno.test("Edge Case: Prefix dot syntax unchanged", async () => {
  const code = "(var arr [1 2 3]) (.push arr 99) arr";
  const result = await run(code);
  assertEquals(result, [1, 2, 3, 99]);
});

Deno.test("Edge Case: Numeric literal with decimal unchanged", async () => {
  const code = "(+ 42.5 10)";
  const result = await run(code);
  assertEquals(result, 52.5);
});

Deno.test("Edge Case: Arguments with dots stay as property access", async () => {
  const code =
    '(var users [{"name": "Alice"} {"name": "Bob"}]) (users.map (fn [u] u.name))';
  const result = await run(code);
  assertEquals(result, ["Alice", "Bob"]);
});

Deno.test("Edge Case: Consecutive dots normalized away", async () => {
  const code = '(var str "test") (str..toUpperCase)';
  const result = await run(code);
  assertEquals(result, "TEST");
});

Deno.test("Edge Case: Property access in arguments", async () => {
  const code = `
    (var person {"profile": {"name": "Alice"}})
    (var getName (fn [p] (js-get (js-get p "profile") "name")))
    (getName person)
  `;
  const result = await run(code);
  assertEquals(result, "Alice");
});

// ============================================================================
// SECTION 4: REGRESSION TESTS (Ensure existing features still work)
// ============================================================================

Deno.test("Regression: Bare property access still works", async () => {
  const code = "(var arr [1 2 3]) arr.length";
  const result = await run(code);
  assertEquals(result, 3);
});

Deno.test("Regression: Spaced chains still work", async () => {
  const code =
    '(var text "  hello  ") (text .trim .toUpperCase)';
  const result = await run(code);
  assertEquals(result, "HELLO");
});

Deno.test("Regression: Complex spaced chains with args still work", async () => {
  const code = `
    (var users [{"name": "Alice" "active": true} {"name": "Bob" "active": false}])
    (users
      .filter (fn [u] u.active)
      .map (fn [u] u.name))
  `;
  const result = await run(code);
  assertEquals(result, ["Alice"]);
});

Deno.test("Regression: Mixed property and method access", async () => {
  const code = '(var obj {"items": [1 2 3]}) (obj.items.length)';
  const result = await run(code);
  assertEquals(result, 3);
});

Deno.test("Regression: Multiline spaced notation", async () => {
  const code = `
    (var arr [1 2 3 4 5 6 7 8 9 10])
    (arr
      .filter (fn [x] (=== (% x 2) 0))
      .map (fn [x] (* x 2))
      .slice 0 3)
  `;
  const result = await run(code);
  assertEquals(result, [4, 8, 12]);
});

// ============================================================================
// SECTION 5: REAL-WORLD PATTERNS
// ============================================================================

Deno.test("Real-world: Data pipeline spaceless", async () => {
  const code = `
    (var data [1 2 3 4 5 6 7 8 9 10])
    (data
      .filter (fn [x] (> x 3))
      .map (fn [x] (* x 2))
      .slice 0 5
      .reduce (fn [acc val] (+ acc val)) 0)
  `;
  const result = await run(code);
  // filter > 3: [4,5,6,7,8,9,10]
  // map *2: [8,10,12,14,16,18,20]
  // slice 0 5: [8,10,12,14,16]
  // reduce sum: 8+10+12+14+16 = 60
  assertEquals(result, 60);
});

Deno.test("Real-world: String manipulation", async () => {
  const code = `
    (var text "  Hello, World!  ")
    (text.trim.toLowerCase.replace "world" "hql")
  `;
  const result = await run(code);
  assertEquals(result, "hello, hql!");
});

Deno.test("Real-world: Array operations", async () => {
  const code = `
    (var numbers [1 2 3 4 5])
    (var doubled (numbers.map (fn [n] (* n 2))))
    (var filtered (doubled.filter (fn [n] (> n 5))))
    (filtered.length)
  `;
  const result = await run(code);
  assertEquals(result, 3); // [6, 8, 10] has length 3
});
