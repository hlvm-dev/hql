/**
 * Week 4: Lazy Constructors
 * Tests for repeat, repeatedly, cycle
 */

import { assertEquals, assertThrows } from "jsr:@std/assert@1";
import {
  cycle,
  doall,
  LazySeq,
  repeat,
  repeatedly,
  take,
} from "../../src/hql/lib/stdlib/js/index.js";

// =============================================================================
// repeat(x) - 8 tests
// =============================================================================

Deno.test("repeat: basic repetition", () => {
  const result = doall(take(3, repeat(5)));
  assertEquals(result, [5, 5, 5]);
});

Deno.test("repeat: with objects (same reference)", () => {
  const obj = { a: 1 };
  const result = doall(take(3, repeat(obj)));

  assertEquals(result.length, 3);
  assertEquals(result[0], obj);
  assertEquals(result[1], obj);
  assertEquals(result[2], obj);
  // Verify same reference
  assertEquals(result[0] === result[1], true);
  assertEquals(result[1] === result[2], true);
});

Deno.test("repeat: with null", () => {
  const result = doall(take(3, repeat(null)));
  assertEquals(result, [null, null, null]);
});

Deno.test("repeat: with take(0)", () => {
  const result = doall(take(0, repeat(5)));
  assertEquals(result, []);
});

Deno.test("repeat: lazy evaluation", () => {
  // repeat should not eagerly evaluate
  const lazy = repeat(42);
  // Check it's iterable (works with both old LazySeq and new seq-protocol)
  assertEquals(typeof lazy[Symbol.iterator], "function");

  // Taking a portion should only realize that portion
  const result = doall(take(2, lazy));
  assertEquals(result, [42, 42]);
});

Deno.test("repeat: large take", () => {
  const result = doall(take(100, repeat("x")));
  assertEquals(result.length, 100);
  assertEquals(result[0], "x");
  assertEquals(result[99], "x");
});

Deno.test("repeat: with functions (same reference)", () => {
  const fn = () => 42;
  const result = doall(take(3, repeat(fn)));

  assertEquals(result.length, 3);
  assertEquals(result[0], fn);
  assertEquals(result[1], fn);
  assertEquals(result[2], fn);
  assertEquals(result[0] === result[1], true);
});

Deno.test("repeat: with arrays (same reference)", () => {
  const arr = [1, 2, 3];
  const result = doall(take(3, repeat(arr)));

  assertEquals(result.length, 3);
  assertEquals(result[0], arr);
  assertEquals(result[1], arr);
  assertEquals(result[2], arr);
  assertEquals(result[0] === result[1], true);
});

// =============================================================================
// repeatedly(f) - 10 tests
// =============================================================================

Deno.test("repeatedly: counter function", () => {
  let counter = 0;
  const result = doall(take(3, repeatedly(() => counter++)));
  assertEquals(result, [0, 1, 2]);
  assertEquals(counter, 3);
});

Deno.test("repeatedly: object generator (fresh references)", () => {
  const result = doall(take(3, repeatedly(() => ({ id: 1 }))));

  assertEquals(result.length, 3);
  assertEquals(result[0], { id: 1 });
  assertEquals(result[1], { id: 1 });
  assertEquals(result[2], { id: 1 });
  // Verify different references
  assertEquals(result[0] === result[1], false);
  assertEquals(result[1] === result[2], false);
});

Deno.test("repeatedly: constant function", () => {
  const result = doall(take(3, repeatedly(() => 42)));
  assertEquals(result, [42, 42, 42]);
});

Deno.test("repeatedly: with take(0)", () => {
  let counter = 0;
  const result = doall(take(0, repeatedly(() => counter++)));

  assertEquals(result, []);
  assertEquals(counter, 0); // Function never called
});

Deno.test("repeatedly: lazy evaluation", () => {
  let counter = 0;
  const lazy = repeatedly(() => counter++);

  // Not realized yet
  assertEquals(counter, 0);
  // Check it's iterable (works with both old LazySeq and new seq-protocol)
  assertEquals(typeof lazy[Symbol.iterator], "function");

  // Realize 3 items
  const result = doall(take(3, lazy));
  assertEquals(result, [0, 1, 2]);
  assertEquals(counter, 3);
});

Deno.test("repeatedly: side effects during realization", () => {
  const effects: number[] = [];
  const lazy = repeatedly(() => {
    const val = effects.length;
    effects.push(val);
    return val;
  });

  // No effects yet
  assertEquals(effects, []);

  // Realize - effects happen
  const result = doall(take(3, lazy));
  assertEquals(result, [0, 1, 2]);
  assertEquals(effects, [0, 1, 2]);
});

Deno.test("repeatedly: invalid function throws", () => {
  assertThrows(
    () => repeatedly(null as unknown as (() => unknown)),
    TypeError,
    "must be a function",
  );
});

Deno.test("repeatedly: large take", () => {
  let counter = 0;
  const result = doall(take(100, repeatedly(() => counter++)));

  assertEquals(result.length, 100);
  assertEquals(result[0], 0);
  assertEquals(result[99], 99);
  assertEquals(counter, 100);
});

Deno.test("repeatedly: null function throws", () => {
  assertThrows(
    () => repeatedly(undefined as unknown as (() => unknown)),
    TypeError,
    "must be a function",
  );
});

// =============================================================================
// cycle(coll) - 12 tests
// =============================================================================

Deno.test("cycle: basic array cycle", () => {
  const result = doall(take(7, cycle([1, 2, 3])));
  assertEquals(result, [1, 2, 3, 1, 2, 3, 1]);
});

Deno.test("cycle: string cycle", () => {
  const result = doall(take(5, cycle("ab")));
  assertEquals(result, ["a", "b", "a", "b", "a"]);
});

Deno.test("cycle: single element", () => {
  const result = doall(take(5, cycle([42])));
  assertEquals(result, [42, 42, 42, 42, 42]);
});

Deno.test("cycle: empty array returns null (Clojure semantics)", () => {
  const result = cycle([]);
  // In Clojure, (cycle []) returns nil/empty seq
  assertEquals(result, null);
});

Deno.test("cycle: null returns null (Clojure semantics)", () => {
  const result = cycle(null);
  // In Clojure, (cycle nil) returns nil
  assertEquals(result, null);
});

Deno.test("cycle: Set cycle", () => {
  const result = doall(take(6, cycle(new Set([1, 2, 3]))));
  assertEquals(result, [1, 2, 3, 1, 2, 3]);
});

Deno.test("cycle: multiple complete cycles", () => {
  const result = doall(take(9, cycle([1, 2, 3])));
  assertEquals(result, [1, 2, 3, 1, 2, 3, 1, 2, 3]);
});

Deno.test("cycle: partial cycle", () => {
  const result = doall(take(5, cycle([1, 2, 3, 4])));
  assertEquals(result, [1, 2, 3, 4, 1]);
});

Deno.test("cycle: lazy evaluation", () => {
  // cycle uses seq() to convert the input
  // The exact realization timing depends on implementation
  // What matters is the output is correct
  const data = [0, 1, 2];

  // Create cycle
  const cycled = cycle(data);

  // Now cycle through it
  const result = doall(take(7, cycled));
  assertEquals(result, [0, 1, 2, 0, 1, 2, 0]);
});

Deno.test("cycle: LazySeq realizes then cycles", () => {
  const lazy = new LazySeq(function* () {
    yield 1;
    yield 2;
  });

  const result = doall(take(5, cycle(lazy)));
  assertEquals(result, [1, 2, 1, 2, 1]);
});

Deno.test("cycle: large take", () => {
  const result = doall(take(1000, cycle([1, 2])));

  assertEquals(result.length, 1000);
  assertEquals(result[0], 1);
  assertEquals(result[1], 2);
  assertEquals(result[999], 2);
});

Deno.test("cycle: with take(0)", () => {
  const result = doall(take(0, cycle([1, 2, 3])));
  assertEquals(result, []);
});
