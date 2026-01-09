/**
 * A simple LRU (Least Recently Used) cache implementation
 * that can be used throughout the codebase for consistent caching
 */
export class LRUCache<K, V> {
  private cache = new Map<K, V>();
  private maxSize: number;
  private onEvict?: (key: K, value: V) => void;

  /**
   * Create a new LRU cache
   * @param maxSize Maximum number of entries (default: 1000)
   * @param onEvict Optional callback called when an entry is evicted (for cleanup)
   */
  constructor(maxSize = 1000, onEvict?: (key: K, value: V) => void) {
    this.maxSize = maxSize;
    this.onEvict = onEvict;
  }

  /**
   * Get a value from the cache
   * @param key The cache key
   * @returns The cached value or undefined if not found
   */
  get(key: K): V | undefined {
    // Single lookup: get() returns undefined for missing keys
    const value = this.cache.get(key);
    if (value !== undefined) {
      // Refresh position by deleting and re-adding
      this.cache.delete(key);
      this.cache.set(key, value); // Re-add to put at the end (most recently used)
      return value;
    }
    // Handle explicit undefined values stored in cache
    if (this.cache.has(key)) {
      this.cache.delete(key);
      this.cache.set(key, value as V);
      return value;
    }
    return undefined;
  }

  /**
   * Set a value in the cache
   * @param key The cache key
   * @param value The value to store
   */
  set(key: K, value: V): void {
    // If maxSize is invalid (0, negative, or NaN), don't store anything
    if (!(this.maxSize > 0)) {
      return;
    }

    // Single operation: delete returns true if key existed (avoids separate has() check)
    const existed = this.cache.delete(key);
    // If key didn't exist and we're at capacity, remove the oldest entry
    if (!existed && this.cache.size >= this.maxSize) {
      // Use .done to check if iterator has entries, not value !== undefined
      // This correctly handles `undefined` as a valid key
      const oldest = this.cache.keys().next();
      if (!oldest.done) {
        const oldestKey = oldest.value;
        // Call onEvict callback before deletion for resource cleanup
        if (this.onEvict) {
          const oldestValue = this.cache.get(oldestKey);
          if (oldestValue !== undefined) {
            this.onEvict(oldestKey, oldestValue);
          }
        }
        this.cache.delete(oldestKey);
      }
    }

    // Add the new value (goes to the end of the Map's iteration order)
    this.cache.set(key, value);
  }

  /**
   * Check if a key exists in the cache
   */
  has(key: K): boolean {
    return this.cache.has(key);
  }

  /**
   * Remove a key from the cache
   * @param key The cache key
   * @param skipOnEvict If true, don't call onEvict callback (used internally when value is being replaced)
   */
  delete(key: K, skipOnEvict = false): boolean {
    if (this.onEvict && !skipOnEvict) {
      // Single lookup: get the value directly
      const value = this.cache.get(key);
      if (value !== undefined) {
        this.onEvict(key, value);
      }
    }
    return this.cache.delete(key);
  }

  /**
   * Clear the entire cache, calling onEvict for each entry
   */
  clear(): void {
    if (this.onEvict) {
      for (const [key, value] of this.cache) {
        this.onEvict(key, value);
      }
    }
    this.cache.clear();
  }

  /**
   * Get the current size of the cache
   */
  get size(): number {
    return this.cache.size;
  }

  /**
   * Iterate over all entries in the cache
   * Note: Iteration order is from oldest to newest
   */
  entries(): IterableIterator<[K, V]> {
    return this.cache.entries();
  }

  /**
   * Iterate over all keys in the cache
   */
  keys(): IterableIterator<K> {
    return this.cache.keys();
  }

  /**
   * Iterate over all values in the cache
   */
  values(): IterableIterator<V> {
    return this.cache.values();
  }

  /**
   * Make the cache iterable with for...of
   */
  [Symbol.iterator](): IterableIterator<[K, V]> {
    return this.cache[Symbol.iterator]();
  }
}
