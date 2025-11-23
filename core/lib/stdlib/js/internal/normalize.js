// internal/normalize.js - Internal helper for collection normalization
// NOTE: This is NOT the public seq() API (see Week 3)
// Purpose: DRY helper for type checking across stdlib functions

import { LazySeq } from "./lazy-seq.js";

/**
 * Normalizes any collection for type checking.
 * Returns null for nil/empty collections, else returns collection as-is.
 *
 * INTERNAL USE ONLY - NOT part of public API!
 *
 * This helper provides consistent handling of:
 * - null/undefined → null
 * - Empty arrays/strings → null
 * - Empty LazySeq → null (after peeking first element)
 * - Non-empty collections → returned as-is
 *
 * Named "normalize" (not "seq") to avoid confusion with Week 3's public seq() API:
 * - normalize(): Returns null for empty, collection-as-is for non-empty (internal)
 * - seq(): Wraps collection in LazySeq (public API, Week 3)
 *
 * @param {*} coll - Collection to normalize
 * @returns {*} - null if empty/nil, else the collection as-is
 *
 * @example
 * normalize(null) // → null
 * normalize([]) // → null
 * normalize([1, 2, 3]) // → [1, 2, 3]
 * normalize(lazySeq(function* () {})) // → null (empty LazySeq)
 */
export function normalize(coll) {
  // Nil/undefined → null
  if (coll == null) return null;

  // Empty array → null, non-empty → as-is
  if (Array.isArray(coll)) {
    return coll.length > 0 ? coll : null;
  }

  // Empty string → null, non-empty → as-is
  if (typeof coll === "string") {
    return coll.length > 0 ? coll : null;
  }

  // LazySeq: Peek first element to check if truly empty
  if (coll instanceof LazySeq) {
    coll._realize(1); // Realize up to 1 element
    const empty = coll._exhausted && coll._realized.length === 0;
    return empty ? null : coll;
  }

  // Other iterables (Set, Map, custom): assume non-empty
  // (If empty, iteration will handle it naturally)
  return coll;
}
