// internal/normalize.js - Internal helper for collection normalization
// NOTE: This is NOT the public seq() API (see Week 3)
// Purpose: DRY helper for type checking across stdlib functions

import { SEQ, EMPTY } from "./seq-protocol.js";
import { LazySeq, OffsetLazySeq, EMPTY_LAZY_SEQ } from "./lazy-seq.js";

/**
 * Normalizes any collection for type checking.
 * Returns null for nil/empty collections, else returns collection as-is.
 *
 * INTERNAL USE ONLY - NOT part of public API!
 *
 * This helper provides consistent handling of:
 * - null/undefined → null
 * - Empty arrays/strings → null
 * - Empty SEQ (EMPTY) → null
 * - Cons/LazySeq → use seq() method for nil-punning
 * - Old generator-based LazySeq → check if empty
 * - Non-empty collections → returned as-is
 *
 * @param {*} coll - Collection to normalize
 * @returns {*} - null if empty/nil, else the collection as-is
 *
 * @example
 * normalize(null) // → null
 * normalize([]) // → null
 * normalize([1, 2, 3]) // → [1, 2, 3]
 * normalize(EMPTY) // → null
 */
export function normalize(coll) {
  // Nil/undefined → null
  if (coll == null) return null;

  // SEQ protocol (new Clojure-aligned): use seq() method for nil-punning
  if (coll[SEQ]) {
    // seq() returns null for empty, this for non-empty
    return coll.seq();
  }

  // Old generator-based LazySeq: check if has first element
  if (coll instanceof LazySeq || coll instanceof OffsetLazySeq) {
    return coll.has(0) ? coll : null;
  }

  // Empty array → null, non-empty → as-is
  if (Array.isArray(coll)) {
    return coll.length > 0 ? coll : null;
  }

  // Empty string → null, non-empty → as-is
  if (typeof coll === "string") {
    return coll.length > 0 ? coll : null;
  }

  // Other iterables (Set, Map, custom): assume non-empty
  // (If empty, iteration will handle it naturally)
  return coll;
}
