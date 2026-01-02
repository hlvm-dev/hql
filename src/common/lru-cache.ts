/**
 * A simple LRU (Least Recently Used) cache implementation
 * that can be used throughout the codebase for consistent caching
 */
export class LRUCache<K, V> {
  private cache = new Map<K, V>();
  private maxSize: number;

  constructor(maxSize = 1000) {
    this.maxSize = maxSize;
  }

  /**
   * Get a value from the cache
   * @param key The cache key
   * @returns The cached value or undefined if not found
   */
  get(key: K): V | undefined {
    // If key exists, get the value and refresh its position by deleting and re-adding
    if (this.cache.has(key)) {
      const value = this.cache.get(key)!;
      this.cache.delete(key);
      this.cache.set(key, value); // Re-add to put at the end (most recently used)
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

    // If key already exists, refresh it
    if (this.cache.has(key)) {
      this.cache.delete(key);
    } // If we're at capacity, remove the oldest entry (first in iteration order)
    else if (this.cache.size >= this.maxSize) {
      // Use .done to check if iterator has entries, not value !== undefined
      // This correctly handles `undefined` as a valid key
      const oldest = this.cache.keys().next();
      if (!oldest.done) {
        this.cache.delete(oldest.value);
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
   */
  delete(key: K): boolean {
    return this.cache.delete(key);
  }

  /**
   * Clear the entire cache
   */
  clear(): void {
    this.cache.clear();
  }

  /**
   * Get the current size of the cache
   */
  get size(): number {
    return this.cache.size;
  }
}
