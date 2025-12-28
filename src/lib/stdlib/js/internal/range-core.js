// range-core.js
// Shared core implementation of range used by both stdlib and transpiler helpers

import { lazySeq } from "./lazy-seq.js";
import { NumericRange } from "./seq-protocol.js";

/**
 * Core range implementation (shared by stdlib.range and __hql_range)
 *
 * Generates a sequence of numbers from start to end with given step.
 *
 * OPTIMIZATION: Uses NumericRange for finite ranges (O(1) count/nth),
 * falls back to generator-based LazySeq for infinite ranges.
 *
 * @param {number} start - Starting number
 * @param {number|undefined} end - Ending number (exclusive), or undefined for infinite sequence
 * @param {number} step - Step size
 * @returns {NumericRange|LazySeq} Sequence of numbers
 */
export function rangeCore(start, end, step) {
  // Infinite sequence case (no end specified or Infinity)
  if (end === undefined || end === Infinity || end === -Infinity) {
    return lazySeq(function* () {
      let i = start;
      while (true) {
        yield i;
        i += step;
      }
    });
  }

  // Finite range: Use NumericRange for O(1) count/nth
  return new NumericRange(start, end, step);
}
