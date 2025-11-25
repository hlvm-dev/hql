// internal/lazy-seq.js - LazySeq implementation
// Internal implementation detail, not part of public API

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// CONSTANTS
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

const PREVIEW_SIZE = 20; // Number of items to show in REPL/toString

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// LAZYSEQ CLASS
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/**
 * LazySeq - A class representing a lazy sequence
 *
 * Implements Clojure-style lazy evaluation:
 * - Values computed on demand
 * - Results memoized (cached)
 * - Single iterator reused
 * - Supports infinite sequences
 */
export class LazySeq {
  constructor(producer) {
    this._producer = producer; // Function that generates values
    this._iterator = null; // Single iterator instance (created lazily)
    this._realized = []; // Cache of realized values
    this._exhausted = false; // Track if we've reached the end
  }

  // Get a specific index, realizing values up to that point
  get(index) {
    this._realize(index + 1);
    return index < this._realized.length ? this._realized[index] : undefined;
  }

  // Convert to array up to a certain size (or all if realized)
  toArray(maxSize = Infinity) {
    if (maxSize === Infinity && this._exhausted) {
      return this._realized.slice();
    }
    this._realize(maxSize);
    return this._realized.slice(0, maxSize);
  }

  // Internal method to realize values up to a certain count
  _realize(count) {
    if (this._exhausted || this._realized.length >= count) {
      return;
    }

    // Create iterator only once, then reuse it
    if (!this._iterator) {
      this._iterator = this._producer();
    }

    while (this._realized.length < count && !this._exhausted) {
      const { value, done } = this._iterator.next();
      if (done) {
        this._exhausted = true;
        break;
      }
      this._realized.push(value);
    }
  }

  // Make the sequence iterable (optimized to avoid repeated get() calls)
  [Symbol.iterator]() {
    let index = 0;
    return {
      next: () => {
        // Realize one more element if needed and not exhausted
        if (index >= this._realized.length && !this._exhausted) {
          this._realize(index + 1);
        }
        // Return current element if available
        if (index < this._realized.length) {
          return { value: this._realized[index++], done: false };
        }
        return { done: true, value: undefined };
      },
    };
  }

  // Add slice compatibility with normal arrays
  slice(start, end) {
    if (end === undefined) {
      // CRITICAL FIX: Cannot slice infinite sequences without an end
      // Must realize entire sequence first, which fails for infinite sequences
      if (!this._exhausted) {
        throw new Error(
          "slice() requires an end parameter for potentially infinite sequences. " +
            "Use toArray() to realize the entire sequence first, or provide an end index.",
        );
      }
      // Sequence is exhausted, safe to slice
      return this._realized.slice(start);
    }
    this._realize(end);
    return this._realized.slice(start, end);
  }

  // Internal helper: get preview for REPL/serialization
  _getPreview() {
    return this.toArray(PREVIEW_SIZE);
  }

  // Safe toString for REPL printing (shows preview, not full realization)
  toString() {
    const preview = this._getPreview();
    return this._exhausted
      ? JSON.stringify(preview)
      : JSON.stringify(preview) + " ...";
  }

  // JSON serialization (shows preview)
  toJSON() {
    const preview = this._getPreview();
    return this._exhausted
      ? preview
      : { preview, hasMore: true, type: "LazySeq" };
  }

  // Node.js/Deno REPL integration (shows preview as array)
  inspect() {
    const preview = this._getPreview();
    return this._exhausted ? preview : [...preview, "..."];
  }

  // Deno-specific REPL integration
  [Symbol.for("Deno.customInspect")]() {
    return this.inspect();
  }

  // Node.js-specific REPL integration
  [Symbol.for("nodejs.util.inspect.custom")]() {
    return this.inspect();
  }
}

/**
 * Create a lazy sequence from a generator function
 */
export function lazySeq(generatorFn) {
  return new LazySeq(generatorFn);
}

/**
 * Singleton empty LazySeq - reused to avoid creating wasteful empty generators
 */
export const EMPTY_LAZY_SEQ = lazySeq(function* () {});
