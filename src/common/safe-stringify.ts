import { isObjectValue } from "./utils.ts";

/**
 * Circular-reference-safe JSON stringification.
 * Handles bigint, function, symbol, and circular references gracefully.
 */
export function safeStringify(value: unknown, spacing = 2): string {
  if (typeof value === "string") return value;
  const seen = new WeakSet<object>();
  try {
    const json = JSON.stringify(
      value,
      (_key, val) => {
        if (typeof val === "bigint") return `${val}n`;
        if (typeof val === "function") return "[Function]";
        if (typeof val === "symbol") return String(val);
        if (isObjectValue(val)) {
          if (seen.has(val)) return "[Circular]";
          seen.add(val);
        }
        return val;
      },
      spacing,
    );
    if (json !== undefined) return json;
  } catch {
    // Fall through to string conversion.
  }
  try {
    return String(value);
  } catch {
    return "[Unserializable]";
  }
}
