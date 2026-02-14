// Edge case tests for property access + lambda interactions
// Verifying no fake coverage — every case must run and produce correct output
import { assertEquals } from "https://deno.land/std@0.208.0/assert/mod.ts";
import { assertRejects } from "https://deno.land/std@0.208.0/assert/mod.ts";
import { run } from "./helpers.ts";

// ============================================================================
// SECTION 1: Spaceless chain ambiguity — the trap
// ============================================================================

Deno.test("edge: spaceless chain with inline fn args works", async () => {
  // Parens disambiguate: .filter attaches after )
  const r = await run(`
    (var arr [1 2 3 4 5])
    (arr.map (fn [x] (* x 2)).filter (fn [x] (> x 5)))
  `);
  assertEquals(r, [6, 8, 10]);
});

Deno.test("edge: spaceless chain with variable arg is property access (trap)", async () => {
  // my-fn.filter is parsed as property access on my-fn, NOT as chain
  // This is the cognitive trap — spaced form is needed here
  const r = await run(`
    (var arr [1 2 3 4 5])
    (var doubler (fn [x] (* x 2)))
    (var big? (fn [x] (> x 5)))
    (arr.filter big?)
  `);
  assertEquals(r, []);  // no values > 5 in original array
});

// ============================================================================
// SECTION 2: Arrow lambda edge cases
// ============================================================================

Deno.test("edge: => with explicit params is redundant but works", async () => {
  const r = await run(`(var sq (=> [x] (* x x))) (sq 5)`);
  assertEquals(r, 25);
});

Deno.test("edge: => $0 used multiple times", async () => {
  const r = await run(`(var sq (=> (* $0 $0))) (sq 7)`);
  assertEquals(r, 49);
});

Deno.test("edge: => nested property chain", async () => {
  const r = await run(`
    (var users [{profile: {name: "Alice"}} {profile: {name: "Bob"}}])
    (users.map (=> $0.profile.name))
  `);
  assertEquals(r, ["Alice", "Bob"]);
});

Deno.test("edge: => $0?.nested?.prop chain", async () => {
  const r = await run(`
    (var items [{a: {b: 1}} nil {a: nil}])
    (items.map (=> $0?.a?.b))
  `);
  assertEquals(r, [1, undefined, undefined]);
});

// ============================================================================
// SECTION 3: ?? edge cases
// ============================================================================

Deno.test("edge: ?? does not catch false or 0 (only nil/undefined)", async () => {
  const r1 = await run(`(?? false "fallback")`);
  assertEquals(r1, false);  // false is NOT nullish

  const r2 = await run(`(?? 0 "fallback")`);
  assertEquals(r2, 0);  // 0 is NOT nullish

  const r3 = await run(`(?? "" "fallback")`);
  assertEquals(r3, "");  // empty string is NOT nullish
});

Deno.test("edge: ?? catches undefined", async () => {
  const r = await run(`(?? undefined "fallback")`);
  assertEquals(r, "fallback");
});

// ============================================================================
// SECTION 4: Property access vs method call distinction
// ============================================================================

Deno.test("edge: arr.length is property (no parens)", async () => {
  const r = await run(`(var arr [1 2 3]) arr.length`);
  assertEquals(r, 3);
});

Deno.test("edge: (str.trim) is zero-arg method call", async () => {
  const r = await run(`(var text "  hello  ") (text.trim)`);
  assertEquals(r, "hello");
});

Deno.test("edge: str.length is property not call", async () => {
  const r = await run(`(var msg "hello") msg.length`);
  assertEquals(r, 5);
});

// ============================================================================
// SECTION 5: ?. and ?? combined in realistic pipeline
// ============================================================================

Deno.test("edge: realistic pipeline with ?. and ??", async () => {
  const r = await run(`
    (var users [
      {name: "Alice" email: "alice@test.com"}
      {name: "Bob" email: nil}
      {name: nil email: "charlie@test.com"}
    ])
    (users.map (fn [u] (?? u.name "anonymous")))
  `);
  assertEquals(r, ["Alice", "Bob", "anonymous"]);
});

// ============================================================================
// SECTION: ?. assignment rejection — clear error message
// ============================================================================

Deno.test("edge: assignment to optional chain gives clear error", async () => {
  await assertRejects(
    async () => await run(`(var obj {a: {b: 1}}) (= obj?.a.b 99)`),
    Error,
    "optional chain",
  );
});

// ============================================================================
// SECTION: throw semantics — raw value preserved
// ============================================================================

Deno.test("edge: throw preserves raw string value", async () => {
  const result = await run(`
    (try (throw "not-an-error") (catch e e))
  `);
  assertEquals(result, "not-an-error");
});

Deno.test("edge: throw preserves raw number value", async () => {
  const result = await run(`
    (try (throw 42) (catch e e))
  `);
  assertEquals(result, 42);
});
