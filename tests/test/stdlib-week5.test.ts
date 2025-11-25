/**
 * Week 5: Sequence Predicates
 * Tests for every, notAny, notEvery, isSome
 */

import { assertEquals, assertThrows } from "jsr:@std/assert@1";
import {
  every,
  isSome,
  LazySeq,
  notAny,
  notEvery,
} from "../core/lib/stdlib/js/index.js";

const identityBoolean = <T>(value: T): boolean => value as unknown as boolean;

// =============================================================================
// every(pred, coll) - 8 tests
// =============================================================================

Deno.test("every: all items match", () => {
  const result = every((x: number) => x % 2 === 0, [2, 4, 6, 8]);
  assertEquals(result, true);
});

Deno.test("every: some items don't match", () => {
  const result = every((x: number) => x % 2 === 0, [2, 3, 6]);
  assertEquals(result, false);
});

Deno.test("every: empty collection (vacuous truth)", () => {
  const result = every((x: number) => x % 2 === 0, []);
  assertEquals(result, true);
});

Deno.test("every: nil collection", () => {
  const result = every((x: number) => x % 2 === 0, null);
  assertEquals(result, true);
});

Deno.test("every: early termination on first false", () => {
  let counter = 0;
  const result = every((x: number) => {
    counter++;
    return x % 2 === 0;
  }, [2, 4, 3, 6, 8]);

  assertEquals(result, false);
  assertEquals(counter, 3); // Stops at index 2 (value 3)
});

Deno.test("every: with falsy values", () => {
  // 0 and false are falsy but pred might return them
  assertEquals(every((x: number) => x > 0, [1, 2, 3]), true);
  assertEquals(every((x: number) => x >= 0, [0, 1, 2]), true);
  assertEquals(every(identityBoolean, [1, 0, 3]), false); // 0 is falsy
  assertEquals(every(identityBoolean, [1, false, 3]), false); // false is falsy
});

Deno.test("every: LazySeq minimal realization", () => {
  let counter = 0;
  const lazy = new LazySeq(function* () {
    for (let i = 1; i <= 10; i++) {
      counter++;
      yield i;
    }
  });

  // Predicate fails at 5
  const result = every((x: number) => x < 5, lazy);

  assertEquals(result, false);
  assertEquals(counter, 5); // Only realized up to the failure point
});

Deno.test("every: invalid predicate throws", () => {
  assertThrows(
    () => every(null as unknown as ((value: number) => boolean), [1, 2, 3]),
    TypeError,
    "must be a function",
  );
});

// =============================================================================
// notAny(pred, coll) - 7 tests
// =============================================================================

Deno.test("notAny: no items match", () => {
  const result = notAny((x: number) => x % 2 === 0, [1, 3, 5, 7]);
  assertEquals(result, true);
});

Deno.test("notAny: some items match", () => {
  const result = notAny((x: number) => x % 2 === 0, [1, 2, 5]);
  assertEquals(result, false);
});

Deno.test("notAny: empty collection", () => {
  const result = notAny((x: number) => x % 2 === 0, []);
  assertEquals(result, true);
});

Deno.test("notAny: nil collection", () => {
  const result = notAny((x: number) => x % 2 === 0, null);
  assertEquals(result, true);
});

Deno.test("notAny: early termination on first true", () => {
  let counter = 0;
  const result = notAny((x: number) => {
    counter++;
    return x % 2 === 0;
  }, [1, 3, 4, 7, 9]);

  assertEquals(result, false);
  assertEquals(counter, 3); // Stops at index 2 (value 4)
});

Deno.test("notAny: LazySeq minimal realization", () => {
  let counter = 0;
  const lazy = new LazySeq(function* () {
    for (let i = 1; i <= 10; i++) {
      counter++;
      yield i;
    }
  });

  // Predicate succeeds at 2 (first even)
  const result = notAny((x: number) => x % 2 === 0, lazy);

  assertEquals(result, false);
  assertEquals(counter, 2); // Only realized up to the match point
});

Deno.test("notAny: invalid predicate throws", () => {
  assertThrows(
    () =>
      notAny(undefined as unknown as ((value: number) => boolean), [1, 2, 3]),
    TypeError,
    "must be a function",
  );
});

// =============================================================================
// notEvery(pred, coll) - 7 tests
// =============================================================================

Deno.test("notEvery: all items match", () => {
  const result = notEvery((x: number) => x % 2 === 0, [2, 4, 6, 8]);
  assertEquals(result, false);
});

Deno.test("notEvery: some items don't match", () => {
  const result = notEvery((x: number) => x % 2 === 0, [2, 3, 6]);
  assertEquals(result, true);
});

Deno.test("notEvery: empty collection", () => {
  const result = notEvery((x: number) => x % 2 === 0, []);
  assertEquals(result, false); // not(vacuous truth) = false
});

Deno.test("notEvery: nil collection", () => {
  const result = notEvery((x: number) => x % 2 === 0, null);
  assertEquals(result, false);
});

Deno.test("notEvery: early termination on first false", () => {
  let counter = 0;
  const result = notEvery((x: number) => {
    counter++;
    return x % 2 === 0;
  }, [2, 4, 3, 6, 8]);

  assertEquals(result, true);
  assertEquals(counter, 3); // Stops at index 2 (value 3)
});

Deno.test("notEvery: LazySeq minimal realization", () => {
  let counter = 0;
  const lazy = new LazySeq(function* () {
    for (let i = 1; i <= 10; i++) {
      counter++;
      yield i;
    }
  });

  // Predicate fails at 1 (first odd)
  const result = notEvery((x: number) => x % 2 === 0, lazy);

  assertEquals(result, true);
  assertEquals(counter, 1); // Only realized first item
});

Deno.test("notEvery: invalid predicate throws", () => {
  assertThrows(
    () =>
      notEvery("not a function" as unknown as ((value: number) => boolean), [
        1,
        2,
        3,
      ]),
    TypeError,
    "must be a function",
  );
});

// =============================================================================
// isSome(x) - 8 tests
// =============================================================================

Deno.test("isSome: null returns false", () => {
  const result = isSome(null);
  assertEquals(result, false);
});

Deno.test("isSome: undefined returns false", () => {
  const result = isSome(undefined);
  assertEquals(result, false);
});

Deno.test("isSome: 0 returns true", () => {
  const result = isSome(0);
  assertEquals(result, true);
});

Deno.test("isSome: false returns true", () => {
  const result = isSome(false);
  assertEquals(result, true);
});

Deno.test("isSome: empty string returns true", () => {
  const result = isSome("");
  assertEquals(result, true);
});

Deno.test("isSome: empty array returns true", () => {
  const result = isSome([]);
  assertEquals(result, true);
});

Deno.test("isSome: empty object returns true", () => {
  const result = isSome({});
  assertEquals(result, true);
});

Deno.test("isSome: truthy values return true", () => {
  assertEquals(isSome(1), true);
  assertEquals(isSome("hello"), true);
  assertEquals(isSome([1, 2, 3]), true);
  assertEquals(isSome({ a: 1 }), true);
  assertEquals(isSome(() => {}), true);
});
