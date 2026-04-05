// internal/validators.js - Validation helpers
// Internal implementation detail, not part of public API

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// VALIDATION HELPERS
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/**
 * Validate that a value is a finite number (can be negative)
 */
export function validateFiniteNumber(n, functionName, paramName) {
  if (typeof n !== "number" || !Number.isFinite(n)) {
    throw new TypeError(
      `${functionName}: ${paramName} must be a finite number, got ${typeof n}`,
    );
  }
}

/**
 * Validate that a value is a non-zero finite number
 */
export function validateNonZeroNumber(n, functionName, paramName) {
  if (typeof n !== "number" || n === 0 || !Number.isFinite(n)) {
    throw new TypeError(
      `${functionName}: ${paramName} must be a non-zero finite number, got ${
        typeof n === "number" ? n : typeof n
      }`,
    );
  }
}

/**
 * Safely serialize a value for error messages (handles circular refs)
 */
function safeStringify(value, maxLength = 50) {
  try {
    const str = JSON.stringify(value);
    return str.length > maxLength ? str.slice(0, maxLength) + "..." : str;
  } catch {
    // Handle circular references, non-serializable values, etc.
    return Object.prototype.toString.call(value);
  }
}

/**
 * Validate that a value is a function
 */
export function validateFunction(
  f,
  functionName,
  paramName = "first argument",
) {
  if (typeof f !== "function") {
    // Show value preview for better debugging (only on error path, no perf cost)
    const valuePreview = typeof f === "object" && f !== null
      ? safeStringify(f)
      : String(f);
    throw new TypeError(
      `${functionName}: ${paramName} must be a function, got ${typeof f} (value: ${valuePreview})`,
    );
  }
}
