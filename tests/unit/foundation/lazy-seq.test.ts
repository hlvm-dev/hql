/**
 * Comprehensive unit tests for the self-hosted stdlib foundation.
 * These tests ensure 100% correctness based on facts, not guesses.
 *
 * Updated for Clojure-aligned seq protocol.
 */

import { assertEquals, assertThrows } from "https://deno.land/std@0.208.0/assert/mod.ts";

// ═══════════════════════════════════════════════════════════════════════════
// FOUNDATION TESTS - Test seq-protocol.js DIRECTLY (not via core.js)
// ═══════════════════════════════════════════════════════════════════════════
// The foundation is seq-protocol.js which provides:
// - SEQ protocol marker
// - EMPTY singleton
// - Cons class (immutable pair)
// - LazySeq class (thunk with memoization + trampolining)
// - Helper functions: lazySeq, cons, toSeq, isSeq, isCons, isLazySeq

const seqProtocol = await import("../../../src/lib/stdlib/js/internal/seq-protocol.js");
const {
  Cons,
  LazySeq,
  ArraySeq,
  lazySeq,
  cons,
  EMPTY,
  SEQ,
  COUNTED,
  INDEXED,
  toSeq,
  isCons,
  isLazySeq,
  isSeq,
  isArraySeq,
  isCounted,
  isIndexed,
  count: foundationCount,
  nth: foundationNth,
} = seqProtocol;

// Foundation-level first/rest/next implementations for testing
// These test the SEQ protocol directly without depending on core.js
// deno-lint-ignore no-explicit-any
function first(coll: any): any {
  if (coll == null) return undefined;
  if (coll[SEQ]) return coll.first();
  if (Array.isArray(coll)) return coll.length > 0 ? coll[0] : undefined;
  for (const item of coll) return item;
  return undefined;
}

// deno-lint-ignore no-explicit-any
function rest(coll: any): any {
  if (coll == null) return EMPTY;
  if (coll[SEQ]) return coll.rest();
  const s = toSeq(coll);
  return s ? s.rest() : EMPTY;
}

// deno-lint-ignore no-explicit-any
function next(coll: any): any {
  if (coll == null) return null;
  if (coll[SEQ]) {
    const r = coll.rest();
    return r.seq();
  }
  const s = toSeq(coll);
  if (s === null) return null;
  return s.rest().seq();
}

// Foundation-level nth (for testing)
// deno-lint-ignore no-explicit-any
function nth(coll: any, index: number, notFound?: any): any {
  const hasNotFound = arguments.length >= 3;
  if (coll == null) {
    if (hasNotFound) return notFound;
    throw new Error(`nth: index ${index} out of bounds`);
  }
  if (Array.isArray(coll)) {
    if (index < coll.length) return coll[index];
    if (hasNotFound) return notFound;
    throw new Error(`nth: index ${index} out of bounds`);
  }
  // SEQ protocol
  let s = coll[SEQ] ? coll : toSeq(coll);
  for (let i = 0; i < index && s; i++) {
    s = s.rest();
    if (s === EMPTY || s.seq() === null) s = null;
  }
  if (s && s !== EMPTY) return s.first();
  if (hasNotFound) return notFound;
  throw new Error(`nth: index ${index} out of bounds`);
}

// Foundation-level count (for testing)
// deno-lint-ignore no-explicit-any
function count(coll: any): number {
  if (coll == null) return 0;
  if (Array.isArray(coll)) return coll.length;
  let n = 0;
  for (const _ of coll) n++;
  return n;
}

// Foundation-level seq (for testing)
// deno-lint-ignore no-explicit-any
function seq(coll: any): any {
  if (coll == null) return null;
  if (coll[SEQ]) return coll.seq();
  return toSeq(coll);
}

// Alias for clarity
const isConsCell = isCons;

// ═══════════════════════════════════════════════════════════════════════════
// LAZYSEQ TESTS
// ═══════════════════════════════════════════════════════════════════════════

// NOTE: New Clojure-aligned LazySeq realizes to Cons or null
// These tests use the new protocol with first()/rest()/seq() methods

Deno.test("LazySeq: basic creation and iteration", () => {
  // In new protocol, LazySeq wraps a thunk that returns Cons or null
  const s = lazySeq(() => seqProtocol.cons(1, lazySeq(() => seqProtocol.cons(2, lazySeq(() => seqProtocol.cons(3, null))))));

  assertEquals([...s], [1, 2, 3]);
});

Deno.test("LazySeq: realizes on first access (memoization)", () => {
  let realized = 0;
  const s = lazySeq(() => {
    realized++;
    return seqProtocol.cons(1, lazySeq(() => {
      realized++;
      return seqProtocol.cons(2, null);
    }));
  });

  // Before any access
  assertEquals(realized, 0);

  // First access realizes first element only
  assertEquals(s.first(), 1);
  assertEquals(realized, 1);

  // Second access uses cache (memoization)
  assertEquals(s.first(), 1);
  assertEquals(realized, 1);

  // Accessing rest realizes next element
  const r = s.rest();
  assertEquals(r.first(), 2);
  assertEquals(realized, 2);
});

Deno.test("LazySeq: seq() returns null for empty", () => {
  const emptySeq = lazySeq(() => null);
  assertEquals(emptySeq.seq(), null);

  const nonEmpty = lazySeq(() => seqProtocol.cons(1, null));
  assertEquals(nonEmpty.seq() !== null, true);
});

Deno.test("LazySeq: handles undefined values correctly", () => {
  // Undefined is a valid value in sequences
  const s = lazySeq(() => seqProtocol.cons(1, lazySeq(() => seqProtocol.cons(undefined, lazySeq(() => seqProtocol.cons(3, null))))));

  assertEquals(s.first(), 1);
  assertEquals(s.rest().first(), undefined);
  assertEquals(s.rest().rest().first(), 3);
  assertEquals([...s], [1, undefined, 3]);
});

Deno.test("LazySeq: memoization (thunk called once)", () => {
  let computeCount = 0;
  const s = lazySeq(() => {
    computeCount++;
    return seqProtocol.cons("computed", null);
  });

  // First access
  s.first();
  assertEquals(computeCount, 1);

  // Second access (should use cache)
  s.first();
  assertEquals(computeCount, 1);

  // Iteration should also use cache
  [...s];
  assertEquals(computeCount, 1);
});

Deno.test("LazySeq: empty sequence", () => {
  const empty = lazySeq(() => null);

  assertEquals([...empty], []);
  assertEquals(empty.first(), undefined);
  assertEquals(empty.seq(), null);
});

Deno.test("LazySeq: toArray works correctly", () => {
  function naturals(n: number): any {
    return lazySeq(() => seqProtocol.cons(n, naturals(n + 1)));
  }
  const nums = naturals(0);

  // Take first 5 using iteration
  const result = [];
  let s = nums;
  for (let i = 0; i < 5; i++) {
    result.push(s.first());
    s = s.rest();
  }
  assertEquals(result, [0, 1, 2, 3, 4]);
});

// ═══════════════════════════════════════════════════════════════════════════
// REST() TESTS (replaces OffsetLazySeq tests - no longer needed)
// ═══════════════════════════════════════════════════════════════════════════

Deno.test("rest: basic access after rest", () => {
  // Create a seq with elements 0-4
  function makeSeq(n: number): any {
    if (n >= 5) return null;
    return seqProtocol.cons(n, lazySeq(() => makeSeq(n + 1)));
  }
  const source = lazySeq(() => makeSeq(0));

  // rest twice should give us [2, 3, 4]
  const r1 = source.rest();
  const r2 = r1.rest();

  assertEquals(r2.first(), 2);
  assertEquals([...r2], [2, 3, 4]);
});

Deno.test("rest: nested rest works correctly", () => {
  // Use array for simplicity
  const arr = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];

  // rest 5 times
  let s = toSeq(arr);
  for (let i = 0; i < 5; i++) {
    s = s.rest();
  }

  assertEquals(s.first(), 5);
  assertEquals([...s], [5, 6, 7, 8, 9]);
});

Deno.test("rest: handles undefined values correctly", () => {
  const s = lazySeq(() => seqProtocol.cons(1,
    lazySeq(() => seqProtocol.cons(undefined,
      lazySeq(() => seqProtocol.cons(3,
        lazySeq(() => seqProtocol.cons(undefined,
          lazySeq(() => seqProtocol.cons(5, null))))))))));

  const r = s.rest();

  // First of rest should be undefined
  assertEquals(r.first(), undefined);
  assertEquals(r.rest().first(), 3);
  assertEquals([...r], [undefined, 3, undefined, 5]);
});

Deno.test("rest: iteration with undefined values", () => {
  const s = lazySeq(() => seqProtocol.cons(undefined,
    lazySeq(() => seqProtocol.cons(1,
      lazySeq(() => seqProtocol.cons(undefined, null))))));

  assertEquals([...s], [undefined, 1, undefined]);
});

// ═══════════════════════════════════════════════════════════════════════════
// CONSCELL TESTS
// ═══════════════════════════════════════════════════════════════════════════

Deno.test("ConsCell: basic cons/first/rest", () => {
  const cell = cons(1, [2, 3]);

  assertEquals(isConsCell(cell), true);
  assertEquals(first(cell), 1);
  assertEquals([...cell], [1, 2, 3]);
});

Deno.test("ConsCell: nested cons", () => {
  const cell = cons(1, cons(2, cons(3, null)));
  assertEquals([...cell], [1, 2, 3]);
});

Deno.test("ConsCell: cons with null rest", () => {
  const cell = cons(42, null);
  assertEquals([...cell], [42]);
});

Deno.test("ConsCell: cons with empty array", () => {
  const cell = cons(1, []);
  assertEquals([...cell], [1]);
});

// ═══════════════════════════════════════════════════════════════════════════
// FIRST/REST/NEXT TESTS
// ═══════════════════════════════════════════════════════════════════════════

Deno.test("first: various collection types", () => {
  assertEquals(first([1, 2, 3]), 1);
  assertEquals(first([]), undefined);
  assertEquals(first(null), undefined);
  assertEquals(first(cons(42, [])), 42);
  // New protocol: lazySeq takes a thunk returning Cons or null
  assertEquals(first(lazySeq(() => seqProtocol.cons("x", null))), "x");
});

Deno.test("first: with undefined as first element", () => {
  assertEquals(first([undefined, 1, 2]), undefined);
  // But it should still "find" it (not return because empty)
  const s = lazySeq(() => seqProtocol.cons(undefined, lazySeq(() => seqProtocol.cons(1, null))));
  assertEquals(first(s), undefined);
});

Deno.test("rest: returns correct remaining elements", () => {
  assertEquals([...rest([1, 2, 3])], [2, 3]);
  assertEquals([...rest([1])], []);
  assertEquals([...rest([])], []);
  assertEquals([...rest(null)], []);
});

Deno.test("rest: with undefined values", () => {
  const result = [...rest([1, undefined, 3])];
  assertEquals(result, [undefined, 3]);
});

Deno.test("rest: on LazySeq returns SEQ-compatible type", () => {
  // In the new Clojure-aligned protocol, rest() returns a Seq (Cons/LazySeq/EMPTY)
  // No longer uses OffsetLazySeq workaround
  const s = lazySeq(() => seqProtocol.cons(1, lazySeq(() => seqProtocol.cons(2, lazySeq(() => seqProtocol.cons(3, null))))));

  const r = rest(s);
  // Should be a SEQ type
  assertEquals(r[SEQ], true);
  assertEquals([...r], [2, 3]);
});

Deno.test("rest: nested rest returns correct elements", () => {
  // In the new protocol, rest() doesn't need OffsetLazySeq
  // Each rest() returns the actual rest of the sequence
  const arr = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];

  const r1 = rest(arr);
  const r2 = rest(r1);
  const r3 = rest(r2);

  // Verify we get correct elements
  assertEquals([...r3], [3, 4, 5, 6, 7, 8, 9]);
});

Deno.test("next: returns null for empty/single element", () => {
  assertEquals(next([]), null);
  assertEquals(next([1]), null);
  assertEquals(next(null), null);
});

Deno.test("next: returns sequence for multiple elements", () => {
  const n = next([1, 2, 3]);
  assertEquals(n !== null, true);
  assertEquals([...n!], [2, 3]);
});

// ═══════════════════════════════════════════════════════════════════════════
// SEQ TESTS
// ═══════════════════════════════════════════════════════════════════════════

Deno.test("seq: returns null for empty collections", () => {
  assertEquals(seq([]), null);
  assertEquals(seq(""), null);
  assertEquals(seq(null), null);
});

Deno.test("seq: returns sequence for non-empty collections", () => {
  const s = seq([1, 2, 3]);
  assertEquals(s !== null, true);
});

Deno.test("seq: with collection starting with undefined", () => {
  const s = seq([undefined, 1, 2]);
  assertEquals(s !== null, true);  // Should NOT be null!
});

Deno.test("seq: LazySeq starting with undefined", () => {
  // New protocol: LazySeq realizes to Cons or null
  const lazy = lazySeq(() => seqProtocol.cons(undefined, lazySeq(() => seqProtocol.cons(1, null))));

  const s = seq(lazy);
  assertEquals(s !== null, true);  // Critical: should NOT be null
});

// ═══════════════════════════════════════════════════════════════════════════
// NTH TESTS
// ═══════════════════════════════════════════════════════════════════════════

Deno.test("nth: basic index access", () => {
  assertEquals(nth([10, 20, 30], 0), 10);
  assertEquals(nth([10, 20, 30], 1), 20);
  assertEquals(nth([10, 20, 30], 2), 30);
});

Deno.test("nth: with undefined values", () => {
  assertEquals(nth([1, undefined, 3], 1), undefined);
});

Deno.test("nth: out of bounds with notFound", () => {
  assertEquals(nth([1, 2, 3], 10, "default"), "default");
});

Deno.test("nth: out of bounds throws without notFound", () => {
  assertThrows(() => nth([1, 2, 3], 10));
});

Deno.test("nth: on sequence with undefined values", () => {
  // Test nth on a seq containing undefined
  const s = lazySeq(() => seqProtocol.cons(1,
    lazySeq(() => seqProtocol.cons(undefined,
      lazySeq(() => seqProtocol.cons(3, null))))));
  const r = s.rest(); // Skip first element

  assertEquals(nth(r, 0), undefined);  // The undefined value
  assertEquals(nth(r, 1), 3);
});

// ═══════════════════════════════════════════════════════════════════════════
// TRUE LAZINESS TESTS (Critical for self-hosted stdlib)
// ═══════════════════════════════════════════════════════════════════════════

Deno.test("laziness: elements computed only when accessed", async () => {
  // This is the CRITICAL test that proves HQL-written stdlib will be lazy
  const cmd = new Deno.Command("deno", {
    args: ["run", "--allow-all", "src/cli/cli.ts", "run", "-e", `
      (var realized 0)

      (fn counting [n]
        (lazy-seq
          (do
            (= realized (+ realized 1))
            (cons n (counting (+ n 1))))))

      (let nums (counting 1))

      ;; Access first 5 elements
      (doall (take 5 nums))

      ;; Print realized count - should be EXACTLY 5
      (print realized)
    `],
    cwd: Deno.cwd(),
  });

  const { code, stdout } = await cmd.output();
  const output = new TextDecoder().decode(stdout).trim();

  assertEquals(code, 0);
  assertEquals(output, "5");  // Must be exactly 5, not more!
});

Deno.test("laziness: first only realizes one element", async () => {
  const cmd = new Deno.Command("deno", {
    args: ["run", "--allow-all", "src/cli/cli.ts", "run", "-e", `
      (var realized 0)

      (fn counting [n]
        (lazy-seq
          (do
            (= realized (+ realized 1))
            (cons n (counting (+ n 1))))))

      (first (counting 1))
      (print realized)
    `],
    cwd: Deno.cwd(),
  });

  const { code, stdout } = await cmd.output();
  const output = new TextDecoder().decode(stdout).trim();

  assertEquals(code, 0);
  assertEquals(output, "1");  // Must be exactly 1!
});

// ═══════════════════════════════════════════════════════════════════════════
// TRAMPOLINING TESTS (Stack Overflow Prevention)
// ═══════════════════════════════════════════════════════════════════════════

Deno.test("trampolining: deeply nested lazy-seq (10000 levels)", async () => {
  // This test would stack overflow without proper trampolining

  // Run in HQL to test the full integration
  const cmd = new Deno.Command("deno", {
    args: ["run", "--allow-all", "src/cli/cli.ts", "run", "-e", `
      (fn natural-numbers [n]
        (lazy-seq (cons n (natural-numbers (+ n 1)))))

      (print (reduce + 0 (take 10000 (natural-numbers 1))))
    `],
    cwd: Deno.cwd(),
  });

  const { code, stdout } = await cmd.output();
  const output = new TextDecoder().decode(stdout).trim();

  assertEquals(code, 0);
  assertEquals(output, "50005000");
});

Deno.test("trampolining: deeply nested rest (1000 levels)", () => {
  // Use array for simplicity (new protocol handles rest chain correctly)
  const arr = Array.from({ length: 2000 }, (_, i) => i);

  // Apply rest 1000 times
  let current: any = toSeq(arr);
  for (let i = 0; i < 1000; i++) {
    current = current.rest();
  }

  // Should not stack overflow and return correct value
  assertEquals(current.first(), 1000);
});

// ═══════════════════════════════════════════════════════════════════════════
// EDGE CASES
// ═══════════════════════════════════════════════════════════════════════════

Deno.test("edge case: empty LazySeq", () => {
  // In new protocol, empty LazySeq realizes to null
  const empty = lazySeq(() => null);

  assertEquals(first(empty), undefined);
  assertEquals([...rest(empty)], []);
  assertEquals(next(empty), null);
  assertEquals(seq(empty), null);
});

Deno.test("edge case: single element LazySeq", () => {
  // In new protocol, LazySeq realizes to Cons or null
  const single = lazySeq(() => seqProtocol.cons(42, null));

  assertEquals(first(single), 42);
  assertEquals([...rest(single)], []);
  assertEquals(next(single), null);
});

Deno.test("edge case: EMPTY singleton", () => {
  // New protocol uses EMPTY (not EMPTY_LAZY_SEQ)
  assertEquals([...EMPTY], []);
  assertEquals(first(EMPTY), undefined);
  assertEquals(EMPTY.seq(), null);
  assertEquals(EMPTY.rest(), EMPTY); // rest of EMPTY is EMPTY
});

Deno.test("edge case: cons with undefined", () => {
  const cell = cons(undefined, [1, 2]);
  assertEquals([...cell], [undefined, 1, 2]);
  assertEquals(first(cell), undefined);
});

// ═══════════════════════════════════════════════════════════════════════════
// INTEGRATION TESTS
// ═══════════════════════════════════════════════════════════════════════════

Deno.test("integration: self-hosted map pattern", async () => {
  const cmd = new Deno.Command("deno", {
    args: ["run", "--allow-all", "src/cli/cli.ts", "run", "-e", `
      (fn my-map [f coll]
        (lazy-seq
          (when-let [s (seq coll)]
            (cons (f (first s)) (my-map f (rest s))))))

      (print (doall (my-map (fn [x] (* x 2)) [1 2 3 4 5])))
    `],
    cwd: Deno.cwd(),
  });

  const { code, stdout } = await cmd.output();
  const output = new TextDecoder().decode(stdout).trim();

  assertEquals(code, 0);
  assertEquals(output, "[ 2, 4, 6, 8, 10 ]");
});

Deno.test("integration: self-hosted filter pattern", async () => {
  const cmd = new Deno.Command("deno", {
    args: ["run", "--allow-all", "src/cli/cli.ts", "run", "-e", `
      (fn my-filter [pred coll]
        (lazy-seq
          (when-let [s (seq coll)]
            (let (f (first s) r (rest s))
              (if (pred f)
                (cons f (my-filter pred r))
                (my-filter pred r))))))

      (print (doall (my-filter (fn [x] (> x 2)) [1 2 3 4 5])))
    `],
    cwd: Deno.cwd(),
  });

  const { code, stdout } = await cmd.output();
  const output = new TextDecoder().decode(stdout).trim();

  assertEquals(code, 0);
  assertEquals(output, "[ 3, 4, 5 ]");
});

Deno.test("integration: loop/recur with 100000 iterations", async () => {
  const cmd = new Deno.Command("deno", {
    args: ["run", "--allow-all", "src/cli/cli.ts", "run", "-e", `
      (fn loop-sum [n]
        (loop [i n acc 0]
          (if (<= i 0)
            acc
            (recur (- i 1) (+ acc i)))))

      (print (loop-sum 100000))
    `],
    cwd: Deno.cwd(),
  });

  const { code, stdout } = await cmd.output();
  const output = new TextDecoder().decode(stdout).trim();

  assertEquals(code, 0);
  assertEquals(output, "5000050000");
});

// ═══════════════════════════════════════════════════════════════════════════
// ARRAYSEQ TESTS (O(1) array operations)
// ═══════════════════════════════════════════════════════════════════════════

Deno.test("ArraySeq: created from toSeq(array)", () => {
  const s = toSeq([1, 2, 3, 4, 5]);
  assertEquals(isArraySeq(s), true);
  assertEquals(s.first(), 1);
  assertEquals([...s], [1, 2, 3, 4, 5]);
});

Deno.test("ArraySeq: O(1) count", () => {
  const s = toSeq([1, 2, 3, 4, 5]);
  assertEquals(isCounted(s), true);
  assertEquals(s.count(), 5);

  const r = s.rest();
  assertEquals(r.count(), 4);

  const rr = r.rest().rest();
  assertEquals(rr.count(), 2);
});

Deno.test("ArraySeq: O(1) nth", () => {
  const s = toSeq([10, 20, 30, 40, 50]);
  assertEquals(isIndexed(s), true);
  assertEquals(s.nth(0), 10);
  assertEquals(s.nth(2), 30);
  assertEquals(s.nth(4), 50);
  // Note: Internal nth returns NOT_FOUND sentinel for out of bounds
  // Use public foundationNth for notFound behavior
  assertEquals(foundationNth(s, 10, "default"), "default");
});

Deno.test("ArraySeq: rest returns ArraySeq", () => {
  const s = toSeq([1, 2, 3]);
  const r = s.rest();
  assertEquals(isArraySeq(r), true);
  assertEquals(r.first(), 2);
  assertEquals([...r], [2, 3]);
});

Deno.test("ArraySeq: rest of single element returns EMPTY", () => {
  const s = toSeq([42]);
  const r = s.rest();
  assertEquals(r, EMPTY);
  assertEquals(r.seq(), null);
});

Deno.test("ArraySeq: efficient iteration (no LazySeq overhead)", () => {
  const arr = Array.from({ length: 10000 }, (_, i) => i);
  const s = toSeq(arr);

  // Count elements via iteration
  let count = 0;
  for (const _ of s) count++;
  assertEquals(count, 10000);

  // Verify first/last
  assertEquals(s.first(), 0);
  assertEquals(s.nth(9999), 9999);
});

// ═══════════════════════════════════════════════════════════════════════════
// COUNTED/INDEXED PROTOCOL TESTS
// ═══════════════════════════════════════════════════════════════════════════

Deno.test("COUNTED: protocol checking", () => {
  assertEquals(isCounted(EMPTY), true);
  assertEquals(isCounted(toSeq([1, 2, 3])), true);  // ArraySeq
  assertEquals(isCounted(cons(1, null)), false);    // Cons not counted
  assertEquals(isCounted(lazySeq(() => null)), false);  // LazySeq not counted
});

Deno.test("INDEXED: protocol checking", () => {
  assertEquals(isIndexed(EMPTY), true);
  assertEquals(isIndexed(toSeq([1, 2, 3])), true);  // ArraySeq
  assertEquals(isIndexed(cons(1, null)), false);   // Cons not indexed
  assertEquals(isIndexed(lazySeq(() => null)), false); // LazySeq not indexed
});

Deno.test("foundationCount: O(1) for counted types", () => {
  assertEquals(foundationCount(null), 0);
  assertEquals(foundationCount([1, 2, 3]), 3);
  assertEquals(foundationCount("hello"), 5);
  assertEquals(foundationCount(new Set([1, 2, 3])), 3);
  assertEquals(foundationCount(EMPTY), 0);
  assertEquals(foundationCount(toSeq([1, 2, 3, 4, 5])), 5);
});

Deno.test("foundationNth: O(1) for indexed types", () => {
  assertEquals(foundationNth([10, 20, 30], 0), 10);
  assertEquals(foundationNth([10, 20, 30], 2), 30);
  assertEquals(foundationNth("hello", 1), "e");
  assertEquals(foundationNth(toSeq([1, 2, 3]), 2), 3);
  assertEquals(foundationNth(EMPTY, 0, "default"), "default");
});

Deno.test("foundationNth: throws on out of bounds", () => {
  assertThrows(() => foundationNth([1, 2, 3], 10));
  assertThrows(() => foundationNth(null, 0));
});

Deno.test("foundationNth: handles undefined values correctly (bug fix)", () => {
  // Critical test: undefined at valid index should NOT throw
  const s = toSeq([1, undefined, 3]);
  assertEquals(foundationNth(s, 0), 1);
  assertEquals(foundationNth(s, 1), undefined);  // Should return undefined, not throw!
  assertEquals(foundationNth(s, 2), 3);

  // Out of bounds with default should still work
  assertEquals(foundationNth(s, 10, "default"), "default");
});

Deno.test("foundationNth: throws on negative indices (bug fix)", () => {
  // Negative indices should throw for all types
  assertThrows(() => foundationNth([1, 2, 3], -1));
  assertThrows(() => foundationNth(toSeq([1, 2, 3]), -1));
  assertThrows(() => foundationNth(cons(1, cons(2, null)), -1));

  // With default should return default
  assertEquals(foundationNth([1, 2, 3], -1, "default"), "default");
  assertEquals(foundationNth(cons(1, null), -1, "default"), "default");
});

// ═══════════════════════════════════════════════════════════════════════════
// PERFORMANCE VERIFICATION
// ═══════════════════════════════════════════════════════════════════════════

Deno.test("performance: ArraySeq O(1) operations after repeated rest()", () => {
  // ArraySeq maintains O(1) first/count/nth even after many rest() calls
  // Each rest() creates new ArraySeq with incremented index (not nested LazySeq)

  const arr = Array.from({ length: 1000 }, (_, i) => i);

  // Using new toSeq (creates ArraySeq)
  const s = toSeq(arr);

  // Apply rest 500 times
  let current = s;
  for (let i = 0; i < 500; i++) {
    current = current.rest();
  }

  // Should still have O(1) access
  assertEquals(current.first(), 500);
  assertEquals(current.count(), 500);
  assertEquals(current.nth(0), 500);
  assertEquals(current.nth(499), 999);
});

// ═══════════════════════════════════════════════════════════════════════════
// CHUNK PROPAGATION TESTS
// ═══════════════════════════════════════════════════════════════════════════

const { isChunked, ChunkedCons, toChunkedSeq, CHUNK_SIZE } = seqProtocol;
const core = await import("../../../src/lib/stdlib/js/core.js");
const { map, filter, reduce } = await import("../../../src/lib/stdlib/js/self-hosted.js");

Deno.test("chunking: toChunkedSeq creates ChunkedCons from large array", () => {
  const arr = Array.from({ length: 100 }, (_, i) => i);
  const chunked = toChunkedSeq(arr);

  assertEquals(isChunked(chunked), true, "Result should be chunked");
  assertEquals(chunked instanceof ChunkedCons, true, "Should be ChunkedCons instance");

  // Verify first chunk has 32 elements
  const firstChunk = chunked.chunkFirst();
  assertEquals(firstChunk.count(), CHUNK_SIZE, "First chunk should have 32 elements");
});

Deno.test("chunking: map propagates through chunked input", () => {
  const arr = Array.from({ length: 100 }, (_, i) => i);

  // First map - should create chunked result
  const mapped1 = map((x: number) => x * 2, arr);
  // Result should be a LazySeq wrapping ChunkedCons

  // Second map on chunked result - should also use chunked path
  const mapped2 = map((x: number) => x + 1, mapped1);

  // Verify correctness
  const result = [...mapped2];
  assertEquals(result.length, 100);
  assertEquals(result[0], 1);    // (0 * 2) + 1 = 1
  assertEquals(result[1], 3);    // (1 * 2) + 1 = 3
  assertEquals(result[99], 199); // (99 * 2) + 1 = 199
});

Deno.test("chunking: filter propagates through chunked input", () => {
  const arr = Array.from({ length: 100 }, (_, i) => i);

  // First filter on large array
  const filtered1 = filter((x: number) => x % 2 === 0, arr);

  // Second filter on filtered result - should use chunked path if propagated
  const filtered2 = filter((x: number) => x % 4 === 0, filtered1);

  // Verify correctness
  const result = [...filtered2];
  assertEquals(result, [0, 4, 8, 12, 16, 20, 24, 28, 32, 36, 40, 44, 48, 52, 56, 60, 64, 68, 72, 76, 80, 84, 88, 92, 96]);
});

Deno.test("chunking: map -> filter chain works correctly", () => {
  const arr = Array.from({ length: 100 }, (_, i) => i);

  // Chain: map -> filter -> map
  const result = [...map(
    (x: number) => x * 10,
    filter(
      (x: number) => x > 10,
      map((x: number) => x + 5, arr)
    )
  )];

  // x + 5 > 10 means x > 5, so we start at 6
  // (6 + 5) * 10 = 110, (7 + 5) * 10 = 120, ...
  assertEquals(result[0], 110);
  assertEquals(result.length, 94); // 100 - 6 = 94 elements pass filter
});

Deno.test("chunking: reduce on chunked sequence works", () => {
  const arr = Array.from({ length: 100 }, (_, i) => i);

  // Map creates chunked result, then reduce should use chunked path
  const mapped = map((x: number) => x * 2, arr);
  const sum = reduce((acc: number, x: number) => acc + x, 0, mapped);

  // Sum of 0*2 + 1*2 + ... + 99*2 = 2 * (0 + 1 + ... + 99) = 2 * 4950 = 9900
  assertEquals(sum, 9900);
});

console.log("All foundation unit tests defined!");
