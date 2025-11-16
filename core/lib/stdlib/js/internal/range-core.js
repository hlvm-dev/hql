// range-core.js
// Shared core implementation of range used by both stdlib and transpiler helpers

import { lazySeq } from "./lazy-seq.js";

/**
 * Core range implementation (shared by stdlib.range and __hql_range)
 *
 * Generates a lazy sequence of numbers from start to end with given step.
 *
 * @param {number} start - Starting number
 * @param {number|undefined} end - Ending number (exclusive), or undefined for infinite sequence
 * @param {number} step - Step size
 * @returns {LazySeq} Lazy sequence of numbers
 */
export function rangeCore(start, end, step) {
  // Infinite sequence case (no end specified)
  if (end === undefined) {
    return lazySeq(function* () {
      let i = start;
      while (true) {
        yield i;
        i += step;
      }
    });
  }

  // Finite lazy sequence
  return lazySeq(function* () {
    if (step > 0) {
      for (let i = start; i < end; i += step) {
        yield i;
      }
    } else {
      for (let i = start; i > end; i += step) {
        yield i;
      }
    }
  });
}
