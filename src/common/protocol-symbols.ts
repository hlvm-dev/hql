/**
 * HQL Protocol Symbols
 * Single source of truth for all protocol symbols used across the codebase.
 *
 * These symbols implement Clojure-style protocols for sequences and collections.
 * Reference: src/lib/stdlib/js/internal/seq-protocol.js
 */

/** ISeq protocol: first(), rest(), seq() */
export const SEQ_SYMBOL = Symbol.for("hql.seq");

/** Counted protocol: count() returns O(1) */
export const COUNTED_SYMBOL = Symbol.for("hql.counted");

/** Indexed protocol: nth(i) returns O(1) */
export const INDEXED_SYMBOL = Symbol.for("hql.indexed");

/** IChunkedSeq protocol: chunked iteration */
export const CHUNKED_SYMBOL = Symbol.for("hql.chunked");
