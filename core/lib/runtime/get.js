/**
 * Runtime get function that intelligently handles both property access and function calls.
 * This function is used when HQL cannot determine at compile-time whether an identifier
 * represents an object (for property access) or a function (for calling).
 *
 * @param {any} obj - The object or function to operate on
 * @param {any} key - The property key or function argument
 * @returns {any} - The property value or function call result
 */
export function get(obj, key) {
  // If obj is a function, call it with the key as argument
  if (typeof obj === "function") {
    return obj(key);
  }

  // Otherwise, treat it as property access
  return obj[key];
}

// Make it available globally for HQL-transpiled code
const globalObject = /** @type {Record<string, unknown>} */ (globalThis);
if (globalObject.get !== get) {
  globalObject.get = get;
}
