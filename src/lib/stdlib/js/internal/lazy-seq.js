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

  // Check if index exists (after realization) - handles undefined values correctly
  // Unlike get(), this distinguishes "value is undefined" from "index out of bounds"
  has(index) {
    this._realize(index + 1);
    return index < this._realized.length;
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

/**
 * OffsetLazySeq - A view of a LazySeq starting at a given offset.
 *
 * CRITICAL for preventing stack overflow with nested rest() calls.
 * Instead of creating nested generators, OffsetLazySeq provides O(1) access
 * by storing a reference to the ORIGINAL source and a cumulative offset.
 *
 * rest(rest(rest(seq))) → OffsetLazySeq(source=seq, offset=3)
 */
export class OffsetLazySeq {
  constructor(source, offset) {
    // If source is already an OffsetLazySeq, collapse to avoid chaining
    if (source instanceof OffsetLazySeq) {
      this._source = source._source;
      this._offset = source._offset + offset;
    } else {
      this._source = source;
      this._offset = offset;
    }
  }

  get(index) {
    return this._source.get(this._offset + index);
  }

  // Check if index exists - delegates to source with offset
  // CRITICAL: This correctly handles sequences containing undefined values
  has(index) {
    return this._source.has(this._offset + index);
  }

  // Make it iterable - optimized to avoid double _realize() calls
  [Symbol.iterator]() {
    let index = 0;
    const source = this._source;
    const offset = this._offset;
    return {
      next: () => {
        // Directly access source's internals for efficiency:
        // _realize once, then check _realized.length
        const actualIndex = offset + index;
        source._realize(actualIndex + 1);
        if (actualIndex < source._realized.length) {
          return { value: source._realized[actualIndex], done: (index++, false) };
        }
        return { done: true, value: undefined };
      },
    };
  }

  // DRY: Single preview generation method
  _getPreview() {
    const preview = [];
    const source = this._source;
    const offset = this._offset;
    for (let i = 0; i < PREVIEW_SIZE; i++) {
      const actualIndex = offset + i;
      source._realize(actualIndex + 1);
      if (actualIndex >= source._realized.length) break;
      preview.push(source._realized[actualIndex]);
    }
    return preview;
  }

  toString() {
    return JSON.stringify(this._getPreview()) + " ...";
  }

  toJSON() {
    return { preview: this._getPreview(), hasMore: true, type: "OffsetLazySeq" };
  }

  inspect() {
    return [...this._getPreview(), "..."];
  }

  [Symbol.for("Deno.customInspect")]() {
    return this.inspect();
  }

  [Symbol.for("nodejs.util.inspect.custom")]() {
    return this.inspect();
  }
}
