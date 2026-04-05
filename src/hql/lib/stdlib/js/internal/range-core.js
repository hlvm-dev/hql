// range-core.js
// Shared core implementation of range used by both stdlib and transpiler helpers

import { NumericRange, lazySeq, cons } from "./seq-protocol.js";

/**
 * Core range implementation (shared by stdlib.range and __hql_range)
 *
 * Generates a sequence of numbers from start to end with given step.
 *
 * OPTIMIZATION: Uses NumericRange for finite ranges (O(1) count/nth),
 * uses Cons-chain LazySeq for infinite ranges (O(1) rest).
 *
 * @param {number} start - Starting number
 * @param {number|undefined} end - Ending number (exclusive), or undefined for infinite sequence
 * @param {number} step - Step size
 * @returns {NumericRange|LazySeq} Sequence of numbers
 */
export function rangeCore(start, end, step) {
  // Infinite sequence case (no end specified or Infinity)
  if (end === undefined || end === Infinity || end === -Infinity) {
    // Use Cons-chain LazySeq (O(1) rest, Clojure-aligned)
    const makeRange = (n) => lazySeq(() => cons(n, makeRange(n + step)));
    return makeRange(start);
  }

  // Finite range: Use NumericRange for O(1) count/nth
  return new NumericRange(start, end, step);
}
