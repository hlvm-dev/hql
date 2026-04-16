// Shim for react/compiler-runtime
// The _c() function creates a memoization cache array used by React Compiler.
// This shim provides the same API without React Compiler installed.
export function c(size: number): unknown[] {
  return new Array(size).fill(Symbol.for("react.memo_cache_sentinel"));
}
