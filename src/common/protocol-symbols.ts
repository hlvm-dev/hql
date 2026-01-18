/**
 * HQL Protocol Symbols
 * Single source of truth for all protocol symbols used across the codebase.
 *
 * These symbols implement Clojure-style protocols for sequences and collections.
 * Reference: src/hql/lib/stdlib/js/internal/seq-protocol.js
 */

/** ISeq protocol: first(), rest(), seq() */
export const SEQ_SYMBOL = Symbol.for("hql.seq");
